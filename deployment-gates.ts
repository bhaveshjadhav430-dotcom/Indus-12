/**
 * autonomous/deployment-gates.ts
 * Block deployment on P1s, drift, coverage, backup age, error rate.
 * Auto-rollback on error spike or latency spike.
 */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'child_process';
import { logger } from '../config/logger';
import { alertWebhook } from '../monitoring/alerts';
import { metrics } from '../monitoring/metrics';
import { incidentManager } from './incident-manager';
import { InvariantEngine } from './invariant-engine';
import { latencyTracker } from './performance-engine';

interface GateResult {
  gate:     string;
  passed:   boolean;
  detail:   string;
  blocking: boolean;
}

const DRIFT_SCORE_THRESHOLD    = 85;
const COVERAGE_THRESHOLD       = 85;
const BACKUP_MAX_AGE_HOURS     = 24;
const ERROR_RATE_THRESHOLD     = 0.03;
const ERROR_SPIKE_THRESHOLD    = 0.03;
const LATENCY_SPIKE_MULTIPLIER = 2;

// ─────────────────────────────────────────────────────────────
// INDIVIDUAL GATES
// ─────────────────────────────────────────────────────────────
async function gateNoOpenP1(prisma: PrismaClient): Promise<GateResult> {
  const count = await incidentManager.getOpenP1Count();
  return {
    gate:     'NO_OPEN_P1_INCIDENTS',
    passed:   count === 0,
    detail:   count === 0 ? 'No open P1 incidents' : `${count} open P1 incident(s) — deployment blocked`,
    blocking: true,
  };
}

async function gateDriftScore(prisma: PrismaClient): Promise<GateResult> {
  const engine = new InvariantEngine(prisma);
  const score  = await engine.getDriftScore();
  return {
    gate:     'DRIFT_SCORE',
    passed:   score >= DRIFT_SCORE_THRESHOLD,
    detail:   `Drift score: ${score} (min: ${DRIFT_SCORE_THRESHOLD})`,
    blocking: true,
  };
}

async function gateCoverage(): Promise<GateResult> {
  try {
    const result = spawnSync(
      'npx', ['jest', '--coverage', '--coverageReporters=json-summary', '--passWithNoTests'],
      { encoding: 'utf-8', stdio: 'pipe', timeout: 120_000 },
    );

    // Parse coverage from stdout or summary file
    const match = result.stdout?.match(/"lines":\s*\{[^}]*"pct":\s*([\d.]+)/);
    const pct   = match ? parseFloat(match[1]) : 0;

    if (pct === 0 && result.status !== 0) {
      return {
        gate:     'TEST_COVERAGE',
        passed:   false,
        detail:   `Coverage check failed: ${result.stderr?.slice(0, 200)}`,
        blocking: true,
      };
    }

    return {
      gate:     'TEST_COVERAGE',
      passed:   pct >= COVERAGE_THRESHOLD,
      detail:   `Line coverage: ${pct.toFixed(1)}% (min: ${COVERAGE_THRESHOLD}%)`,
      blocking: true,
    };
  } catch (err: any) {
    return { gate: 'TEST_COVERAGE', passed: false, detail: err.message, blocking: true };
  }
}

async function gateBackupFreshness(prisma: PrismaClient): Promise<GateResult> {
  const rows = await prisma.$queryRaw<{ validated_at: Date; status: string }[]>`
    SELECT validated_at, status FROM backup_validations
    WHERE status = 'PASSED'
    ORDER BY validated_at DESC
    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      gate: 'BACKUP_FRESHNESS', passed: false,
      detail: 'No successful backup validation on record', blocking: true,
    };
  }

  const ageMs   = Date.now() - rows[0].validated_at.getTime();
  const ageHrs  = ageMs / 3_600_000;
  return {
    gate:     'BACKUP_FRESHNESS',
    passed:   ageHrs < BACKUP_MAX_AGE_HOURS,
    detail:   `Last validated backup: ${ageHrs.toFixed(1)}h ago (max: ${BACKUP_MAX_AGE_HOURS}h)`,
    blocking: true,
  };
}

async function gateErrorRate(): Promise<GateResult> {
  const rate = metrics.getGauge('http.error_rate');
  return {
    gate:     'ERROR_RATE',
    passed:   rate <= ERROR_RATE_THRESHOLD,
    detail:   `Current error rate: ${(rate * 100).toFixed(2)}% (max: ${ERROR_RATE_THRESHOLD * 100}%)`,
    blocking: true,
  };
}

async function gateMigrations(prisma: PrismaClient): Promise<GateResult> {
  const pending = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NULL
  `;
  return {
    gate:     'MIGRATIONS_CLEAN',
    passed:   pending.length === 0,
    detail:   pending.length === 0 ? 'All migrations applied' : `Pending: ${pending.map(m => m.migration_name).join(', ')}`,
    blocking: true,
  };
}

// ─────────────────────────────────────────────────────────────
// DEPLOYMENT GATE RUNNER
// ─────────────────────────────────────────────────────────────
export async function runDeploymentGates(
  prisma:      PrismaClient,
  triggeredBy?: string,
  skipCoverage = false,
): Promise<void> {
  logger.info('[DEPLOY:GATE] Running deployment gates...');

  const checks: Array<() => Promise<GateResult>> = [
    () => gateNoOpenP1(prisma),
    () => gateDriftScore(prisma),
    () => gateBackupFreshness(prisma),
    () => gateErrorRate(),
    () => gateMigrations(prisma),
  ];

  if (!skipCoverage) checks.push(() => gateCoverage());

  const results = await Promise.allSettled(checks.map(fn => fn()));

  const gates: GateResult[] = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : {
      gate: `GATE_${i}`, passed: false, detail: `Check error: ${(r as any).reason}`, blocking: true,
    }
  );

  const blockers = gates.filter(g => !g.passed && g.blocking);

  // Persist gate log
  await prisma.$executeRaw`
    INSERT INTO deployment_gates (passed, gates, blockers, triggered_by)
    VALUES (${blockers.length === 0}, ${JSON.stringify(gates)}::JSONB,
            ${JSON.stringify(blockers)}::JSONB, ${triggeredBy ?? 'system'})
  `;

  for (const g of gates) {
    logger.info(`[DEPLOY:GATE] ${g.passed ? '✅' : '🚫'} ${g.gate}: ${g.detail}`);
  }

  if (blockers.length > 0) {
    const body = blockers.map(b => `🚫 ${b.gate}: ${b.detail}`).join('\n');
    await alertWebhook({
      severity: 'CRITICAL',
      title:    `Deployment BLOCKED (${blockers.length} gate${blockers.length > 1 ? 's' : ''} failed)`,
      body,
    });
    throw new Error(`Deployment blocked:\n${body}`);
  }

  logger.info('[DEPLOY:GATE] ✅ All gates passed — deployment approved');
}

// ─────────────────────────────────────────────────────────────
// AUTO-ROLLBACK WATCHER
// ─────────────────────────────────────────────────────────────
export class AutoRollbackWatcher {
  private baselineErrorRate   = 0;
  private baselineP95:         Map<string, number> = new Map();
  private watchTimer?:        NodeJS.Timeout;
  private spikeDetectedAt?:   number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly rollbackFn: () => Promise<void>,
  ) {}

  captureBaseline(): void {
    this.baselineErrorRate = metrics.getGauge('http.error_rate');
    for (const ep of latencyTracker.getAll()) {
      this.baselineP95.set(ep.endpoint, ep.p95);
    }
    logger.info('[ROLLBACK:WATCHER] Baseline captured', {
      errorRate: this.baselineErrorRate,
    });
  }

  start(): void {
    this.watchTimer = setInterval(() => this.check(), 30_000);
  }

  private async check(): Promise<void> {
    const currentError = metrics.getGauge('http.error_rate');
    const errorSpike   = currentError > ERROR_SPIKE_THRESHOLD && currentError > this.baselineErrorRate * 2;

    let latencySpike = false;
    for (const ep of latencyTracker.getAll()) {
      const baseline = this.baselineP95.get(ep.endpoint) ?? 200;
      if (ep.p95 > baseline * LATENCY_SPIKE_MULTIPLIER && ep.p95 > 500) {
        latencySpike = true;
        break;
      }
    }

    if (errorSpike || latencySpike) {
      if (!this.spikeDetectedAt) {
        this.spikeDetectedAt = Date.now();
        logger.warn('[ROLLBACK:WATCHER] Spike detected, monitoring...', { errorSpike, latencySpike });
        return;
      }

      // Sustained spike for 60 seconds → rollback
      if (Date.now() - this.spikeDetectedAt > 60_000) {
        logger.error('[ROLLBACK:WATCHER] Sustained spike — triggering AUTO-ROLLBACK');
        await alertWebhook({
          severity: 'CRITICAL',
          title:    'AUTO-ROLLBACK TRIGGERED',
          body:     `Error rate: ${(currentError * 100).toFixed(2)}%. Spike sustained for 60s. Rolling back.`,
        });
        await incidentManager.createIncident({
          priority: 'P1',
          title:    'Auto-rollback triggered post-deploy',
          details:  { errorRate: currentError, errorSpike, latencySpike },
        });
        this.stop();
        await this.rollbackFn();
      }
    } else {
      this.spikeDetectedAt = undefined;
    }
  }

  stop(): void {
    clearInterval(this.watchTimer);
  }
}
