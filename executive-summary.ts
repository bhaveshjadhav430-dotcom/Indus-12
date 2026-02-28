/**
 * autonomous/executive-summary.ts
 * Daily automated JSON report: revenue, credit, stock anomalies, errors, incidents, health.
 * Webhook dispatch.
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { metrics } from '../monitoring/metrics';
import { alertWebhook } from '../monitoring/alerts';
import { incidentManager } from './incident-manager';
import { HealthScoreEngine } from './health-score';
import { InvariantEngine } from './invariant-engine';

const EXEC_WEBHOOK_URL = process.env.EXECUTIVE_WEBHOOK_URL ?? '';

export interface ExecutiveSummary {
  generatedAt:        string;
  periodDate:         string;
  revenue: {
    todayPaise:       number;
    todayINR:         string;
    salesCount:       number;
    avgSalePaise:     number;
  };
  credit: {
    totalOutstandingPaise: number;
    totalOutstandingINR:   string;
    customersWithCredit:   number;
    overdueCustomers:      number;
  };
  stock: {
    anomalyCount:     number;
    lowStockAlerts:   number;
    negativeStockCount: number;
  };
  operations: {
    errorRate:        number;
    p95LatencyMs:     number;
    uptimeSeconds:    number;
  };
  incidents: {
    summary:          Record<string, number>;
    openP1:           number;
    resolvedToday:    number;
    autoHealedToday:  number;
  };
  healthScore:        number;
  healthGrade:        string;
  driftScore:         number;
  safeMode:           boolean;
}

async function getRevenue(prisma: PrismaClient): Promise<ExecutiveSummary['revenue']> {
  const rows = await prisma.$queryRaw<{
    total_paise: number; sales_count: number;
  }[]>`
    SELECT COALESCE(SUM("totalAmountPaise"), 0) AS total_paise,
           COUNT(*) AS sales_count
    FROM "Sale"
    WHERE status = 'CONFIRMED'
      AND "confirmedAt" >= CURRENT_DATE
  `;
  const total_paise = Number(rows[0]?.total_paise ?? 0);
  const sales_count = Number(rows[0]?.sales_count ?? 0);
  return {
    todayPaise:    total_paise,
    todayINR:      (total_paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' }),
    salesCount:    sales_count,
    avgSalePaise:  sales_count > 0 ? Math.round(total_paise / sales_count) : 0,
  };
}

async function getCredit(prisma: PrismaClient): Promise<ExecutiveSummary['credit']> {
  const rows = await prisma.$queryRaw<{
    total_outstanding: number; customer_count: number;
  }[]>`
    SELECT
      COALESCE(SUM(
        s."creditAmountPaise" -
        COALESCE((SELECT SUM(cp."amountPaise") FROM "CreditPayment" cp WHERE cp."customerId" = c.id), 0)
      ), 0) AS total_outstanding,
      COUNT(DISTINCT c.id) AS customer_count
    FROM "Customer" c
    JOIN "Sale" s ON s."customerId" = c.id AND s.status = 'CONFIRMED'
  `;

  const overdue = await prisma.$queryRaw<{ count: string }[]>`
    SELECT COUNT(DISTINCT c.id) AS count
    FROM "Customer" c
    JOIN "Sale" s ON s."customerId" = c.id AND s.status = 'CONFIRMED'
    WHERE s."confirmedAt" < NOW() - INTERVAL '30 days'
      AND (
        s."creditAmountPaise" -
        COALESCE((SELECT SUM(cp."amountPaise") FROM "CreditPayment" cp WHERE cp."customerId" = c.id), 0)
      ) > 0
  `;

  const total = Number(rows[0]?.total_outstanding ?? 0);
  return {
    totalOutstandingPaise: total,
    totalOutstandingINR:   (total / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' }),
    customersWithCredit:   Number(rows[0]?.customer_count ?? 0),
    overdueCustomers:      parseInt(overdue[0]?.count ?? '0'),
  };
}

async function getStockStats(prisma: PrismaClient): Promise<ExecutiveSummary['stock']> {
  const [neg, low, anomalies] = await Promise.all([
    prisma.$queryRaw<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM "StockLedger" WHERE "quantityOnHand" < 0
    `,
    prisma.$queryRaw<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM "StockAlert" WHERE status = 'OPEN'
    `,
    prisma.$queryRaw<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM invariant_violations
      WHERE created_at >= CURRENT_DATE
        AND invariant IN ('NO_NEGATIVE_STOCK','STOCK_MOVEMENT_BALANCE')
    `,
  ]);

  return {
    negativeStockCount: parseInt(neg[0]?.count ?? '0'),
    lowStockAlerts:     parseInt(low[0]?.count ?? '0'),
    anomalyCount:       parseInt(anomalies[0]?.count ?? '0'),
  };
}

async function getIncidentStats(prisma: PrismaClient): Promise<ExecutiveSummary['incidents']> {
  const [summary, resolved] = await Promise.all([
    incidentManager.getIncidentSummary(),
    prisma.$queryRaw<{ total: string; auto_healed: string }[]>`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN auto_healed THEN 1 ELSE 0 END) AS auto_healed
      FROM incidents
      WHERE resolved_at >= CURRENT_DATE
    `,
  ]);

  return {
    summary,
    openP1:          summary['P1'] ?? 0,
    resolvedToday:   parseInt(resolved[0]?.total ?? '0'),
    autoHealedToday: parseInt(resolved[0]?.auto_healed ?? '0'),
  };
}

export async function generateExecutiveSummary(prisma: PrismaClient): Promise<ExecutiveSummary> {
  logger.info('[EXEC] Generating executive summary...');

  const healthEngine = new HealthScoreEngine(prisma);
  const invEngine    = new InvariantEngine(prisma);

  const [revenue, credit, stock, incStats, healthReport, driftScore] = await Promise.all([
    getRevenue(prisma),
    getCredit(prisma),
    getStockStats(prisma),
    getIncidentStats(prisma),
    healthEngine.compute(),
    invEngine.getDriftScore(),
  ]);

  const summary: ExecutiveSummary = {
    generatedAt:  new Date().toISOString(),
    periodDate:   new Date().toISOString().split('T')[0],
    revenue,
    credit,
    stock,
    operations: {
      errorRate:      metrics.getGauge('http.error_rate'),
      p95LatencyMs:   metrics.getPercentile('http.request_duration_ms', 95),
      uptimeSeconds:  Math.round(process.uptime()),
    },
    incidents:    incStats,
    healthScore:  healthReport.score,
    healthGrade:  healthReport.grade,
    driftScore,
    safeMode:     healthReport.safeMode,
  };

  // Persist
  await prisma.$executeRaw`
    INSERT INTO executive_reports (period_date, report)
    VALUES (CURRENT_DATE, ${JSON.stringify(summary)}::JSONB)
    ON CONFLICT (period_date) DO UPDATE
      SET report = EXCLUDED.report
  `;

  // Dispatch webhook
  if (EXEC_WEBHOOK_URL) {
    try {
      const res = await fetch(EXEC_WEBHOOK_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(summary),
        signal:  AbortSignal.timeout(10_000),
      });

      await prisma.$executeRaw`
        UPDATE executive_reports
        SET dispatched = TRUE, dispatched_at = NOW()
        WHERE period_date = CURRENT_DATE
      `;

      if (!res.ok) logger.warn('[EXEC] Webhook dispatch non-OK', { status: res.status });
    } catch (err) {
      logger.error('[EXEC] Webhook dispatch failed', { err });
    }
  }

  // Alert if health is poor
  if (healthReport.grade === 'D' || healthReport.grade === 'F') {
    await alertWebhook({
      severity: 'HIGH',
      title:    `Executive Summary — Health Grade: ${healthReport.grade} (${healthReport.score}/100)`,
      body:     `Revenue today: ${revenue.todayINR}\nOutstanding credit: ${credit.totalOutstandingINR}\nOpen P1 incidents: ${incStats.openP1}\nSafe mode: ${summary.safeMode}`,
    });
  }

  logger.info('[EXEC] Summary generated', {
    health: healthReport.score,
    revenue: revenue.todayINR,
  });

  return summary;
}
