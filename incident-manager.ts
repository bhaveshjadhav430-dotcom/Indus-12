/**
 * autonomous/incident-manager.ts
 * P1–P4 incident lifecycle: create, auto-resolve, escalate, forensic snapshots.
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { alertWebhook } from '../monitoring/alerts';
import type { InvariantResult } from './invariant-engine';

type IncidentPriority = 'P1' | 'P2' | 'P3' | 'P4';
type IncidentStatus   = 'OPEN' | 'AUTO_HEALING' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

const MAX_AUTO_HEAL_ATTEMPTS = 3;
const ESCALATE_AFTER_MS      = 15 * 60 * 1000; // 15 min

interface StoredIncident {
  id:                  string;
  priority:            IncidentPriority;
  status:              IncidentStatus;
  title:               string;
  invariant:           string | null;
  details:             Record<string, unknown>;
  forensic_snapshot:   Record<string, unknown> | null;
  auto_heal_attempts:  number;
  auto_healed:         boolean;
  created_at:          Date;
  updated_at:          Date;
  resolved_at:         Date | null;
  escalated_at:        Date | null;
}

class IncidentManager {
  private prisma!: PrismaClient;

  init(prisma: PrismaClient): void {
    this.prisma = prisma;
  }

  async createOrUpdateFromInvariant(
    result: InvariantResult,
    priority: IncidentPriority,
  ): Promise<void> {
    // Find existing open incident for this invariant
    const existing = await this.prisma.$queryRaw<StoredIncident[]>`
      SELECT * FROM incidents
      WHERE invariant = ${result.name}
        AND status NOT IN ('RESOLVED','CLOSED')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (existing.length > 0) {
      const inc = existing[0];
      if (result.passed && result.autoCorrected) {
        await this.autoResolve(inc.id, 'Auto-corrected by invariant engine');
      } else if (!result.passed) {
        await this.incrementHealAttempts(inc.id, result);
      }
      return;
    }

    if (!result.passed) {
      await this.createIncident({
        priority,
        title:    `Invariant violation: ${result.name}`,
        invariant: result.name,
        details:  { violations: result.violations.slice(0, 50), violationCount: result.violations.length },
      });
    }
  }

  async createIncident(opts: {
    priority:  IncidentPriority;
    title:     string;
    invariant?: string;
    details:   Record<string, unknown>;
  }): Promise<string> {
    const forensic = await this.captureForensicSnapshot();

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO incidents (priority, title, invariant, details, forensic_snapshot)
      VALUES (${opts.priority}::incident_priority, ${opts.title},
              ${opts.invariant ?? null}, ${JSON.stringify(opts.details)}::JSONB,
              ${JSON.stringify(forensic)}::JSONB)
      RETURNING id
    `;

    const id = rows[0].id;
    logger.error(`[INCIDENT] Created ${opts.priority} incident: ${opts.title}`, { id });

    const severity = opts.priority === 'P1' ? 'CRITICAL' :
                     opts.priority === 'P2' ? 'HIGH'     :
                     opts.priority === 'P3' ? 'MEDIUM'   : 'LOW';

    await alertWebhook({
      severity,
      title: `[${opts.priority}] ${opts.title}`,
      body:  JSON.stringify(opts.details, null, 2).slice(0, 1000),
    });

    return id;
  }

  async autoResolve(incidentId: string, reason: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE incidents
      SET status = 'RESOLVED', resolved_reason = ${reason},
          resolved_at = NOW(), auto_healed = TRUE, updated_at = NOW()
      WHERE id = ${incidentId} AND status NOT IN ('RESOLVED','CLOSED')
    `;
    logger.info(`[INCIDENT] Auto-resolved: ${incidentId} — ${reason}`);
  }

  async incrementHealAttempts(incidentId: string, result: InvariantResult): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE incidents
      SET auto_heal_attempts = auto_heal_attempts + 1,
          status = 'AUTO_HEALING',
          details = details || ${JSON.stringify({ lastViolationCount: result.violations.length, updatedAt: new Date() })}::JSONB,
          updated_at = NOW()
      WHERE id = ${incidentId}
    `;

    const updated = await this.prisma.$queryRaw<{ auto_heal_attempts: number; created_at: Date }[]>`
      SELECT auto_heal_attempts, created_at FROM incidents WHERE id = ${incidentId}
    `;

    if (!updated[0]) return;
    const { auto_heal_attempts, created_at } = updated[0];
    const ageMs = Date.now() - created_at.getTime();

    if (auto_heal_attempts >= MAX_AUTO_HEAL_ATTEMPTS || ageMs > ESCALATE_AFTER_MS) {
      await this.escalate(incidentId, `${auto_heal_attempts} heal attempts / ${Math.round(ageMs / 60000)}m old`);
    }
  }

  async escalate(incidentId: string, reason: string): Promise<void> {
    const [inc] = await this.prisma.$queryRaw<StoredIncident[]>`
      SELECT * FROM incidents WHERE id = ${incidentId}
    `;
    if (!inc || inc.status === 'ESCALATED') return;

    await this.prisma.$executeRaw`
      UPDATE incidents
      SET status = 'ESCALATED', escalated_at = NOW(), updated_at = NOW()
      WHERE id = ${incidentId}
    `;

    logger.error(`[INCIDENT] ESCALATED ${inc.priority}: ${inc.title}`, { reason });
    await alertWebhook({
      severity: inc.priority === 'P1' ? 'CRITICAL' : 'HIGH',
      title:    `[ESCALATED][${inc.priority}] ${inc.title}`,
      body:     `Escalated after: ${reason}\nForensic snapshot captured at incident creation.`,
    });
  }

  async getOpenP1Count(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM incidents
      WHERE priority = 'P1' AND status NOT IN ('RESOLVED','CLOSED')
    `;
    return parseInt(rows[0]?.count ?? '0');
  }

  async getIncidentSummary(): Promise<Record<string, number>> {
    const rows = await this.prisma.$queryRaw<{ priority: string; count: string }[]>`
      SELECT priority, COUNT(*) AS count FROM incidents
      WHERE status NOT IN ('RESOLVED','CLOSED')
      GROUP BY priority
    `;
    return rows.reduce((acc, r) => ({ ...acc, [r.priority]: parseInt(r.count) }), {});
  }

  private async captureForensicSnapshot(): Promise<Record<string, unknown>> {
    try {
      const [stockNeg, saleGaps, dbConns] = await Promise.all([
        this.prisma.$queryRaw<{ count: string }[]>`SELECT COUNT(*) FROM "StockLedger" WHERE "quantityOnHand" < 0`,
        this.prisma.$queryRaw<{ count: string }[]>`
          SELECT COUNT(*) FROM "Sale" s
          WHERE s.status = 'CONFIRMED'
            AND ABS(s."totalAmountPaise" - (s."paidAmountPaise" + s."creditAmountPaise")) > 1
        `,
        this.prisma.$queryRaw<{ count: string }[]>`SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active'`,
      ]);
      return {
        capturedAt:      new Date().toISOString(),
        negativeStock:   parseInt(stockNeg[0]?.count ?? '0'),
        paymentGapSales: parseInt(saleGaps[0]?.count ?? '0'),
        dbConnections:   parseInt(dbConns[0]?.count ?? '0'),
        nodeMemoryMB:    Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        uptime:          process.uptime(),
      };
    } catch {
      return { capturedAt: new Date().toISOString(), error: 'snapshot_failed' };
    }
  }
}

export const incidentManager = new IncidentManager();
