/**
 * autonomous/self-healing-core.ts
 * Deadlock retry, circuit breaker, distributed idempotency, duplicate detection.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../config/logger';
import { metrics } from '../monitoring/metrics';

// ─────────────────────────────────────────────────────────────
// SLEEP
// ─────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// CIRCUIT BREAKER
// ─────────────────────────────────────────────────────────────
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state:           CircuitState = 'CLOSED';
  private failureCount:    number = 0;
  private successCount:    number = 0;
  private lastStateChange: number = Date.now();

  constructor(
    private readonly name:            string,
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs:  number  = 30_000,
    private readonly halfOpenProbes:  number  = 2,
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastStateChange > this.resetTimeoutMs) {
        this.transitionTo('HALF_OPEN');
      } else {
        throw new Error(`CircuitBreaker[${this.name}] OPEN — rejecting call`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenProbes) {
        this.transitionTo('CLOSED');
        this.successCount = 0;
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    metrics.increment(`circuit_breaker.${this.name}.failure`);
    if (this.failureCount >= this.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(state: CircuitState): void {
    logger.warn(`[CIRCUIT:${this.name}] ${this.state} → ${state}`);
    this.state           = state;
    this.lastStateChange = Date.now();
    metrics.gauge(`circuit_breaker.${this.name}.state`,
      state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2);
  }

  getState(): CircuitState { return this.state; }
}

// ─────────────────────────────────────────────────────────────
// RETRY WITH JITTER (deadlock-aware)
// ─────────────────────────────────────────────────────────────
function isDeadlock(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === 'P2034';
  }
  if (err instanceof Error) {
    return err.message.includes('deadlock detected') ||
           err.message.includes('could not serialize') ||
           err.message.includes('lock timeout');
  }
  return false;
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return ['P1001','P1002','P1008','P1017'].includes(err.code);
  }
  if (err instanceof Error) {
    return err.message.includes('ECONNREFUSED') ||
           err.message.includes('ETIMEDOUT') ||
           err.message.includes('socket hang up');
  }
  return false;
}

export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  label  = 'tx',
  maxAttempts = 5,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isDeadlock(err) || attempt === maxAttempts) {
        metrics.increment('db.deadlock_retry.exhausted');
        throw err;
      }
      const jitter = Math.random() * 50;
      const delay  = Math.min(50 * 2 ** (attempt - 1) + jitter, 2_000);
      logger.warn(`[DEADLOCK:${label}] attempt ${attempt} — retry in ${Math.round(delay)}ms`);
      metrics.increment('db.deadlock_retry.count');
      await sleep(delay);
    }
  }
  throw new Error(`unreachable`);
}

export async function withNetworkRetry<T>(
  fn:     () => Promise<T>,
  cb:     CircuitBreaker,
  label = 'op',
): Promise<T> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await cb.call(fn);
    } catch (err) {
      if (!isNetworkError(err) || attempt === maxAttempts) throw err;
      const delay = Math.min(200 * 2 ** (attempt - 1) + Math.random() * 100, 5_000);
      logger.warn(`[NETWORK:${label}] attempt ${attempt} — retry in ${Math.round(delay)}ms`);
      await sleep(delay);
    }
  }
  throw new Error(`unreachable`);
}

// ─────────────────────────────────────────────────────────────
// DISTRIBUTED IDEMPOTENCY KEY REGISTRY
// ─────────────────────────────────────────────────────────────
export interface IdempotencyResult<T = unknown> {
  cached:      boolean;
  statusCode:  number;
  body:        T;
}

export class IdempotencyRegistry {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Returns cached response if key exists, otherwise executes fn and stores result.
   * Locked flag prevents concurrent duplicate requests from running fn twice.
   */
  async execute<T>(
    key:        string,
    fn:         () => Promise<{ statusCode: number; body: T }>,
    ttlSeconds = 86_400,
  ): Promise<IdempotencyResult<T>> {
    const existing = await this.prisma.$queryRaw<{
      response_body: T; status_code: number; locked: boolean;
    }[]>`
      SELECT response_body, status_code, locked
      FROM idempotency_keys
      WHERE id = ${key} AND expires_at > NOW()
    `;

    if (existing.length > 0) {
      if (existing[0].locked) {
        // In-flight duplicate — wait and retry
        await sleep(500);
        return this.execute(key, fn, ttlSeconds);
      }
      metrics.increment('idempotency.cache_hit');
      return { cached: true, statusCode: existing[0].status_code, body: existing[0].response_body };
    }

    // Acquire lock
    await this.prisma.$executeRaw`
      INSERT INTO idempotency_keys (id, locked, locked_at, expires_at)
      VALUES (${key}, TRUE, NOW(), NOW() + ${ttlSeconds} * INTERVAL '1 second')
      ON CONFLICT (id) DO NOTHING
    `;

    try {
      const result = await fn();

      await this.prisma.$executeRaw`
        UPDATE idempotency_keys
        SET response_body = ${JSON.stringify(result.body)}::JSONB,
            status_code   = ${result.statusCode},
            locked        = FALSE
        WHERE id = ${key}
      `;

      metrics.increment('idempotency.stored');
      return { cached: false, ...result };
    } catch (err) {
      // Release lock on failure — caller can retry
      await this.prisma.$executeRaw`DELETE FROM idempotency_keys WHERE id = ${key}`;
      throw err;
    }
  }

  async cleanup(): Promise<void> {
    const result = await this.prisma.$executeRaw`
      DELETE FROM idempotency_keys WHERE expires_at < NOW()
    `;
    logger.info('[IDEMPOTENCY] Cleanup complete', { deleted: result });
  }

  async detectDuplicateTransaction(
    businessKey: string,
    windowMs = 300_000,
  ): Promise<boolean> {
    const windowSec = Math.floor(windowMs / 1000);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM idempotency_keys
      WHERE id LIKE ${`dup:${businessKey}:%`}
        AND created_at > NOW() - ${windowSec} * INTERVAL '1 second'
      LIMIT 1
    `;
    return rows.length > 0;
  }

  async registerTransaction(businessKey: string): Promise<void> {
    const key = `dup:${businessKey}:${Date.now()}`;
    await this.prisma.$executeRaw`
      INSERT INTO idempotency_keys (id, response_body, status_code, expires_at)
      VALUES (${key}, 'null'::JSONB, 200, NOW() + INTERVAL '5 minutes')
      ON CONFLICT DO NOTHING
    `;
  }
}

// Global circuit breakers
export const dbCircuitBreaker    = new CircuitBreaker('database', 5, 30_000);
export const redisCircuitBreaker = new CircuitBreaker('redis',    5, 20_000);
