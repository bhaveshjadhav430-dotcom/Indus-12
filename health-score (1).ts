/**
 * autonomous/health-score.ts
 * 0–100 health score, emergency safe mode, GET /system-health endpoint.
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { metrics } from '../monitoring/metrics';
import { alertWebhook } from '../monitoring/alerts';
import { incidentManager } from './incident-manager';
import { InvariantEngine } from './invariant-engine';

// ─────────────────────────────────────────────────────────────
// HEALTH SCORE COMPONENTS
// ─────────────────────────────────────────────────────────────
interface HealthComponents {
  integrity:       number; // 0–30
  errorRate:       number; // 0–20
  latency:         number; // 0–15
  incidents:       number; // 0–20
  backup:          number; // 0–10
  migrations:      number; // 0–5
}

export interface HealthReport {
  score:       number;
  grade:       'A' | 'B' | 'C' | 'D' | 'F';
  components:  HealthComponents;
  safeMode:    boolean;
  timestamp:   string;
  incidents:   Record<string, number>;
  driftScore:  number;
}

async function scoreIntegrity(prisma: PrismaClient): Promise<number> {
  const engine     = new InvariantEngine(prisma);
  const driftScore = await engine.getDriftScore();
  // drift 100 → integrity 30, drift 0 → integrity 0
  return Math.round((driftScore / 100) * 30);
}

async function scoreErrorRate(): Promise<number> {
  const rate = metrics.getGauge('http.error_rate');
  if (rate === 0)        return 20;
  if (rate < 0.005)      return 18;
  if (rate < 0.01)       return 15;
  if (rate < 0.03)       return 10;
  if (rate < 0.05)       return 5;
  return 0;
}

async function scoreLatency(): Promise<number> {
  const p95 = metrics.getPercentile('http.request_duration_ms', 95);
  if (p95 === 0)   return 15; // no traffic
  if (p95 < 100)   return 15;
  if (p95 < 200)   return 12;
  if (p95 < 500)   return 8;
  if (p95 < 1000)  return 4;
  return 0;
}

async function scoreIncidents(prisma: PrismaClient): Promise<number> {
  const summary = await incidentManager.getIncidentSummary();
  let deduction = 0;
  deduction += (summary['P1'] ?? 0) * 10;
  deduction += (summary['P2'] ?? 0) * 5;
  deduction += (summary['P3'] ?? 0) * 2;
  deduction += (summary['P4'] ?? 0) * 1;
  return Math.max(0, 20 - deduction);
}

async function scoreBackup(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRaw<{ validated_at: Date }[]>`
    SELECT validated_at FROM backup_validations
    WHERE status = 'PASSED'
    ORDER BY validated_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return 0;
  const ageHrs = (Date.now() - rows[0].validated_at.getTime()) / 3_600_000;
  if (ageHrs < 12)  return 10;
  if (ageHrs < 24)  return 7;
  if (ageHrs < 48)  return 3;
  return 0;
}

async function scoreMigrations(prisma: PrismaClient): Promise<number> {
  try {
    const pending = await prisma.$queryRaw<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
    `;
    return parseInt(pending[0]?.count ?? '0') === 0 ? 5 : 0;
  } catch {
    return 3; // table might not exist in all envs
  }
}

// ─────────────────────────────────────────────────────────────
// HEALTH SCORE ENGINE
// ─────────────────────────────────────────────────────────────
export class HealthScoreEngine {
  constructor(private readonly prisma: PrismaClient) {}

  async compute(): Promise<HealthReport> {
    const [integrity, errorRate, latency, incidents, backup, migrations] = await Promise.all([
      scoreIntegrity(this.prisma).catch(() => 20),
      scoreErrorRate(),
      scoreLatency(),
      scoreIncidents(this.prisma).catch(() => 15),
      scoreBackup(this.prisma).catch(() => 5),
      scoreMigrations(this.prisma).catch(() => 3),
    ]);

    const components: HealthComponents = { integrity, errorRate, latency, incidents, backup, migrations };
    const score = Object.values(components).reduce((a, b) => a + b, 0);

    const grade: HealthReport['grade'] =
      score >= 90 ? 'A' :
      score >= 75 ? 'B' :
      score >= 60 ? 'C' :
      score >= 40 ? 'D' : 'F';

    const safeMode = await this.isSafeMode();
    const incidentSummary = await incidentManager.getIncidentSummary();
    const engine = new InvariantEngine(this.prisma);
    const driftScore = await engine.getDriftScore();

    const report: HealthReport = {
      score, grade, components, safeMode,
      timestamp: new Date().toISOString(),
      incidents: incidentSummary,
      driftScore,
    };

    // Persist
    await this.prisma.$executeRaw`
      INSERT INTO health_scores (score, components, safe_mode)
      VALUES (${score}, ${JSON.stringify(components)}::JSONB, ${safeMode})
    `;

    metrics.gauge('system.health_score', score);

    // Alert on critical health
    if (score < 40 && !safeMode) {
      await alertWebhook({
        severity: 'CRITICAL',
        title:    `System health critical: ${score}/100 (${grade})`,
        body:     JSON.stringify(components, null, 2),
      });
      // Auto-engage safe mode if F
      if (grade === 'F') {
        await this.enableSafeMode('Health score F — auto-engaged by health engine');
      }
    }

    return report;
  }

  // ─────────────────────────────────────────────────────────
  // SAFE MODE
  // ─────────────────────────────────────────────────────────
  async isSafeMode(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ safe_mode: boolean }[]>`
      SELECT safe_mode FROM system_mode WHERE id = 1
    `;
    return rows[0]?.safe_mode ?? false;
  }

  async enableSafeMode(reason: string, enabledBy = 'system'): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE system_mode
      SET safe_mode = TRUE, safe_mode_reason = ${reason},
          enabled_at = NOW(), enabled_by = ${enabledBy}, updated_at = NOW()
      WHERE id = 1
    `;
    logger.fatal(`[SAFE_MODE] ENABLED — ${reason}`);
    await alertWebhook({
      severity: 'CRITICAL',
      title:    '🔴 SAFE MODE ENGAGED — Write operations disabled',
      body:     reason,
    });
    metrics.gauge('system.safe_mode', 1);
  }

  async disableSafeMode(overrideToken: string, disabledBy: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ override_token: string | null }[]>`
      SELECT override_token FROM system_mode WHERE id = 1
    `;

    const expected = rows[0]?.override_token;
    if (expected && expected !== overrideToken) {
      logger.error('[SAFE_MODE] Override token mismatch — refusing disable');
      return false;
    }

    await this.prisma.$executeRaw`
      UPDATE system_mode
      SET safe_mode = FALSE, safe_mode_reason = NULL,
          enabled_at = NULL, override_token = NULL, updated_at = NOW()
      WHERE id = 1
    `;
    logger.info(`[SAFE_MODE] Disabled by ${disabledBy}`);
    metrics.gauge('system.safe_mode', 0);
    return true;
  }

  async setSafeModeOverrideToken(token: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE system_mode SET override_token = ${token} WHERE id = 1
    `;
  }
}

// ─────────────────────────────────────────────────────────────
// SAFE MODE MIDDLEWARE
// ─────────────────────────────────────────────────────────────
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function safeModeMiddleware(engine: HealthScoreEngine) {
  return async (req: any, reply: any, done: () => void) => {
    if (!WRITE_METHODS.has(req.method)) return done();

    // Allow safe-mode management endpoints
    if (req.url?.startsWith('/system-mode')) return done();

    try {
      const safe = await engine.isSafeMode();
      if (safe) {
        reply.code(503).send({
          error:   'SERVICE_IN_SAFE_MODE',
          message: 'System is in safe mode. Write operations are temporarily disabled. Contact administrators.',
          readOnly: true,
        });
        return;
      }
    } catch {
      // If we can't check safe mode, fail closed
      reply.code(503).send({ error: 'SAFE_MODE_CHECK_FAILED' });
      return;
    }

    done();
  };
}
