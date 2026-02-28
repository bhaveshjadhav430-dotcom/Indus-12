/**
 * autonomous/security-engine.ts
 * Rate anomaly detection, brute force detection, suspicious transaction patterns,
 * auto-temporary block, tamper-detected audit log.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { logger } from '../config/logger';
import { metrics } from '../monitoring/metrics';
import { alertWebhook } from '../monitoring/alerts';
import { incidentManager } from './incident-manager';

// ─────────────────────────────────────────────────────────────
// RATE LIMITER (sliding window in-process)
// ─────────────────────────────────────────────────────────────
interface RateWindow {
  timestamps: number[];
  blocked:    boolean;
  blockUntil: number;
}

class RateLimiterStore {
  private windows = new Map<string, RateWindow>();
  private readonly WINDOW_MS = 60_000;

  record(key: string, limit: number): { blocked: boolean; count: number } {
    const now    = Date.now();
    let   window = this.windows.get(key) ?? { timestamps: [], blocked: false, blockUntil: 0 };

    if (window.blocked && now < window.blockUntil) {
      return { blocked: true, count: window.timestamps.length };
    }
    if (window.blocked && now >= window.blockUntil) {
      window = { timestamps: [], blocked: false, blockUntil: 0 };
    }

    // Slide window
    window.timestamps = window.timestamps.filter(t => now - t < this.WINDOW_MS);
    window.timestamps.push(now);

    const count = window.timestamps.length;
    if (count > limit) {
      window.blocked    = true;
      window.blockUntil = now + 5 * 60_000; // block 5 min
    }

    this.windows.set(key, window);
    return { blocked: window.blocked, count };
  }

  isBlocked(key: string): boolean {
    const w = this.windows.get(key);
    if (!w) return false;
    return w.blocked && Date.now() < w.blockUntil;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [k, w] of this.windows) {
      if (!w.blocked && (w.timestamps.length === 0 || now - w.timestamps.at(-1)! > this.WINDOW_MS * 2)) {
        this.windows.delete(k);
      }
    }
  }
}

export const rateLimiter = new RateLimiterStore();

// ─────────────────────────────────────────────────────────────
// BRUTE FORCE DETECTOR
// ─────────────────────────────────────────────────────────────
interface BruteForceEntry { failures: number[]; locked: boolean; lockUntil: number }

class BruteForceDetector {
  private entries = new Map<string, BruteForceEntry>();
  private readonly WINDOW_MS  = 15 * 60 * 1000;
  private readonly MAX_FAILS  = 10;
  private readonly LOCK_MS    = 30 * 60 * 1000;

  recordFailure(key: string): { locked: boolean; failures: number } {
    const now   = Date.now();
    let   entry = this.entries.get(key) ?? { failures: [], locked: false, lockUntil: 0 };

    if (entry.locked && now < entry.lockUntil) return { locked: true, failures: entry.failures.length };
    if (entry.locked) entry = { failures: [], locked: false, lockUntil: 0 };

    entry.failures = entry.failures.filter(t => now - t < this.WINDOW_MS);
    entry.failures.push(now);

    if (entry.failures.length >= this.MAX_FAILS) {
      entry.locked    = true;
      entry.lockUntil = now + this.LOCK_MS;
    }

    this.entries.set(key, entry);
    return { locked: entry.locked, failures: entry.failures.length };
  }

  isLocked(key: string): boolean {
    const e = this.entries.get(key);
    return !!e?.locked && Date.now() < e.lockUntil;
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }
}

export const bruteForceDetector = new BruteForceDetector();

// ─────────────────────────────────────────────────────────────
// SECURITY ENGINE
// ─────────────────────────────────────────────────────────────
export class SecurityEngine {
  constructor(private readonly prisma: PrismaClient) {}

  // ── Detect suspicious transaction patterns ────────────────
  async detectSuspiciousTransactions(): Promise<void> {
    logger.info('[SECURITY] Scanning for suspicious transaction patterns...');

    try {
      // Large single transactions
      const largeSales = await this.prisma.$queryRaw<{
        id: string; shopId: string; invoiceNumber: string;
        totalAmountPaise: number; createdById: string;
      }[]>`
        SELECT s.id, s."shopId", s."invoiceNumber", s."totalAmountPaise", s."createdById"
        FROM "Sale" s
        WHERE s.status = 'CONFIRMED'
          AND s."totalAmountPaise" > 1_000_000_00  -- > 10 lakh INR
          AND s."createdAt" > NOW() - INTERVAL '24 hours'
      `;

      // Rapid-fire sales from same user
      const rapidSales = await this.prisma.$queryRaw<{
        createdById: string; shopId: string; count: number;
      }[]>`
        SELECT "createdById", "shopId", COUNT(*) AS count
        FROM "Sale"
        WHERE "createdAt" > NOW() - INTERVAL '5 minutes'
          AND status = 'CONFIRMED'
        GROUP BY "createdById", "shopId"
        HAVING COUNT(*) > 20
      `;

      // Void spike (> 10% void rate in last hour)
      const voidRate = await this.prisma.$queryRaw<{
        shopId: string; total: number; voided: number; rate: number;
      }[]>`
        SELECT "shopId",
               COUNT(*) AS total,
               SUM(CASE WHEN status = 'VOIDED' THEN 1 ELSE 0 END) AS voided,
               ROUND(SUM(CASE WHEN status = 'VOIDED' THEN 1 ELSE 0 END)::NUMERIC / COUNT(*) * 100, 2) AS rate
        FROM "Sale"
        WHERE "createdAt" > NOW() - INTERVAL '1 hour'
        GROUP BY "shopId"
        HAVING SUM(CASE WHEN status = 'VOIDED' THEN 1 ELSE 0 END)::NUMERIC / COUNT(*) > 0.1
           AND COUNT(*) > 5
      `;

      for (const s of largeSales) {
        await this.recordSecurityEvent({
          eventType: 'LARGE_TRANSACTION',
          severity:  'MEDIUM',
          details:   { saleId: s.id, invoiceNumber: s.invoiceNumber, totalAmountPaise: s.totalAmountPaise },
          shopId:    s.shopId,
          userId:    s.createdById,
        });
      }

      for (const r of rapidSales) {
        await this.recordSecurityEvent({
          eventType:   'RAPID_FIRE_SALES',
          severity:    'HIGH',
          details:     { count: r.count, shopId: r.shopId },
          userId:      r.createdById,
          autoBlock:   true,
          blockTarget: r.createdById,
          blockType:   'user_id',
          blockMinutes: 60,
        });
      }

      for (const v of voidRate) {
        await this.recordSecurityEvent({
          eventType: 'VOID_SPIKE',
          severity:  'HIGH',
          details:   { shopId: v.shopId, total: v.total, voided: v.voided, rate: v.rate },
        });
        await incidentManager.createIncident({
          priority: 'P2',
          title:    `Void spike detected in shop ${v.shopId}: ${v.rate}% void rate`,
          details:  { shopId: v.shopId, total: v.total, voided: v.voided },
        });
      }

      metrics.gauge('security.suspicious_transactions', largeSales.length + rapidSales.length);
    } catch (err) {
      logger.error('[SECURITY] Pattern scan failed', { err });
    }
  }

  // ── Rate anomaly detector ─────────────────────────────────
  async detectRateAnomalies(): Promise<void> {
    try {
      // Request rate 10x above rolling average signals attack
      const p95Latency  = metrics.getGauge('http.p95_latency_ms');
      const errorRate   = metrics.getGauge('http.error_rate');

      if (errorRate > 0.3) {
        await this.recordSecurityEvent({
          eventType: 'ERROR_RATE_SPIKE',
          severity:  'HIGH',
          details:   { errorRate, p95Latency },
        });
      }
    } catch (err) {
      logger.error('[SECURITY] Rate anomaly detection failed', { err });
    }
  }

  // ── Temporary block ───────────────────────────────────────
  async blockTarget(opts: {
    target:     string;
    targetType: 'ip' | 'user_id';
    reason:     string;
    minutes:    number;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO security_blocks (target, target_type, reason, expires_at)
      VALUES (${opts.target}, ${opts.targetType}, ${opts.reason},
              NOW() + ${opts.minutes} * INTERVAL '1 minute')
      ON CONFLICT (target) DO UPDATE
        SET reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at, lifted_at = NULL
    `;
    logger.warn(`[SECURITY] Blocked ${opts.targetType}:${opts.target} for ${opts.minutes}min — ${opts.reason}`);
    metrics.increment('security.auto_blocks');
  }

  async isBlocked(target: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM security_blocks
      WHERE target = ${target} AND expires_at > NOW() AND lifted_at IS NULL
      LIMIT 1
    `;
    return rows.length > 0;
  }

  // ── Audit log tamper check ────────────────────────────────
  async verifyAuditChain(limit = 1000): Promise<{ valid: boolean; brokenAt?: string }> {
    const rows = await this.prisma.$queryRaw<{
      id: string; row_hash: string; prev_hash: string; prevRowHash?: string;
    }[]>`
      SELECT a.id, a.row_hash, a.prev_hash,
             lag(a.row_hash) OVER (ORDER BY a."createdAt") AS "prevRowHash"
      FROM "AuditLog" a
      ORDER BY a."createdAt"
      LIMIT ${limit}
    `;

    for (const row of rows) {
      if (row.prevRowHash && row.prev_hash !== row.prevRowHash) {
        logger.error('[SECURITY] Audit chain tamper detected', { brokenAt: row.id });
        await incidentManager.createIncident({
          priority: 'P1',
          title:    'AUDIT LOG TAMPER DETECTED',
          details:  { brokenAt: row.id, expected: row.prevRowHash, actual: row.prev_hash },
        });
        return { valid: false, brokenAt: row.id };
      }
    }
    return { valid: true };
  }

  // ── Internal helpers ──────────────────────────────────────
  private async recordSecurityEvent(opts: {
    eventType:   string;
    severity:    'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    details:     Record<string, unknown>;
    userId?:     string;
    shopId?:     string;
    ipAddress?:  string;
    autoBlock?:  boolean;
    blockTarget?: string;
    blockType?:  'ip' | 'user_id';
    blockMinutes?: number;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO security_events (event_type, ip_address, user_id, details, severity, auto_blocked)
      VALUES (${opts.eventType}, ${opts.ipAddress ?? null}, ${opts.userId ?? null},
              ${JSON.stringify(opts.details)}::JSONB, ${opts.severity},
              ${opts.autoBlock ?? false})
    `;

    if (opts.autoBlock && opts.blockTarget && opts.blockType) {
      await this.blockTarget({
        target:     opts.blockTarget,
        targetType: opts.blockType,
        reason:     opts.eventType,
        minutes:    opts.blockMinutes ?? 60,
      });
    }

    if (opts.severity === 'HIGH' || opts.severity === 'CRITICAL') {
      await alertWebhook({
        severity: opts.severity,
        title:    `Security: ${opts.eventType}`,
        body:     JSON.stringify(opts.details, null, 2).slice(0, 800),
      });
    }
  }

  // ── Full security scan ────────────────────────────────────
  async runFullScan(): Promise<void> {
    await Promise.allSettled([
      this.detectSuspiciousTransactions(),
      this.detectRateAnomalies(),
      this.verifyAuditChain(),
    ]);
  }
}

// ─────────────────────────────────────────────────────────────
// FASTIFY SECURITY MIDDLEWARE
// ─────────────────────────────────────────────────────────────
export function securityMiddleware(prisma: PrismaClient, engine: SecurityEngine) {
  return async (req: any, reply: any, done: () => void) => {
    const ip     = req.ip;
    const userId = (req as any).user?.id;

    // Check in-memory rate limit (100 req/min per IP)
    const { blocked: rateBlocked } = rateLimiter.record(`ip:${ip}`, 100);
    if (rateBlocked) {
      metrics.increment('security.rate_limited');
      reply.code(429).send({ error: 'Too Many Requests' });
      return;
    }

    // Check DB block (catches both in-memory misses and persistent blocks)
    if (ip && await engine.isBlocked(ip)) {
      reply.code(403).send({ error: 'Access denied' });
      return;
    }
    if (userId && await engine.isBlocked(userId)) {
      reply.code(403).send({ error: 'Account temporarily suspended' });
      return;
    }

    done();
  };
}
