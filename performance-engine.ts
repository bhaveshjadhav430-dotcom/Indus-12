/**
 * autonomous/performance-engine.ts
 * p95 latency tracking, slow query detection, index suggestions, overload prediction.
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { metrics } from '../monitoring/metrics';
import { alertWebhook } from '../monitoring/alerts';
import { incidentManager } from './incident-manager';

interface LatencyBucket {
  samples: number[];
  lastReset: number;
}

interface QueryStat {
  query:     string;
  mean_ms:   number;
  calls:     number;
  totalMs:   number;
}

// ─────────────────────────────────────────────────────────────
// IN-PROCESS LATENCY TRACKER
// ─────────────────────────────────────────────────────────────
class LatencyTracker {
  private buckets = new Map<string, LatencyBucket>();
  private readonly BUCKET_MAX   = 2000;
  private readonly RESET_MS     = 5 * 60 * 1000;

  record(endpoint: string, ms: number): void {
    let bucket = this.buckets.get(endpoint);
    if (!bucket || Date.now() - bucket.lastReset > this.RESET_MS) {
      bucket = { samples: [], lastReset: Date.now() };
      this.buckets.set(endpoint, bucket);
    }
    bucket.samples.push(ms);
    if (bucket.samples.length > this.BUCKET_MAX) bucket.samples.shift();
  }

  getPercentile(endpoint: string, p: number): number {
    const bucket = this.buckets.get(endpoint);
    if (!bucket || bucket.samples.length === 0) return 0;
    const sorted = [...bucket.samples].sort((a, b) => a - b);
    const idx    = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  getAll(): Array<{ endpoint: string; p50: number; p95: number; p99: number; samples: number }> {
    return Array.from(this.buckets.entries()).map(([endpoint, b]) => ({
      endpoint,
      p50:     this.getPercentile(endpoint, 50),
      p95:     this.getPercentile(endpoint, 95),
      p99:     this.getPercentile(endpoint, 99),
      samples: b.samples.length,
    }));
  }

  getBaseline(endpoint: string): number {
    return this.getPercentile(endpoint, 50);
  }
}

export const latencyTracker = new LatencyTracker();

// ─────────────────────────────────────────────────────────────
// SLOW QUERY DETECTOR (pg_stat_statements)
// ─────────────────────────────────────────────────────────────
async function detectSlowQueries(prisma: PrismaClient): Promise<QueryStat[]> {
  try {
    const rows = await prisma.$queryRaw<QueryStat[]>`
      SELECT query,
             ROUND((mean_exec_time)::NUMERIC, 2)  AS mean_ms,
             calls,
             ROUND((total_exec_time)::NUMERIC, 2) AS "totalMs"
      FROM pg_stat_statements
      WHERE mean_exec_time > 500
        AND calls > 10
        AND query NOT LIKE '%pg_stat%'
        AND query NOT LIKE '%_prisma_migrations%'
      ORDER BY mean_exec_time DESC
      LIMIT 20
    `;
    return rows;
  } catch {
    // pg_stat_statements may not be installed
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// INDEX SUGGESTION ENGINE
// ─────────────────────────────────────────────────────────────
async function suggestIndexes(prisma: PrismaClient): Promise<string[]> {
  try {
    const missing = await prisma.$queryRaw<{
      relname: string; seq_scan: string; seq_tup_read: string; idx_scan: string;
    }[]>`
      SELECT relname,
             seq_scan::TEXT,
             seq_tup_read::TEXT,
             COALESCE(idx_scan, 0)::TEXT AS idx_scan
      FROM pg_stat_user_tables
      WHERE seq_scan > 100
        AND seq_tup_read > 10000
        AND (idx_scan IS NULL OR idx_scan < seq_scan * 0.1)
        AND relname NOT LIKE 'pg_%'
      ORDER BY seq_tup_read DESC
      LIMIT 10
    `;

    return missing.map(r =>
      `-- HIGH seq_scan on "${r.relname}" (seq=${r.seq_scan}, tup=${r.seq_tup_read}, idx=${r.idx_scan})\n` +
      `-- Consider: CREATE INDEX CONCURRENTLY ON "${r.relname}" (<filter_column>);`
    );
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// MEMORY GROWTH TREND
// ─────────────────────────────────────────────────────────────
const memSamples: Array<{ ts: number; mb: number }> = [];

function sampleMemory(): void {
  const mb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  memSamples.push({ ts: Date.now(), mb });
  if (memSamples.length > 60) memSamples.shift(); // keep 60 samples
  metrics.gauge('process.heap_mb', mb);
}

function detectMemoryGrowthTrend(): { growing: boolean; slopeMbPerMin: number } {
  if (memSamples.length < 10) return { growing: false, slopeMbPerMin: 0 };
  const n    = memSamples.length;
  const sumX = memSamples.reduce((acc, s) => acc + s.ts, 0);
  const sumY = memSamples.reduce((acc, s) => acc + s.mb, 0);
  const sumXY = memSamples.reduce((acc, s) => acc + s.ts * s.mb, 0);
  const sumX2 = memSamples.reduce((acc, s) => acc + s.ts ** 2, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX ** 2); // bytes/ms
  const slopeMbPerMin = slope * 60_000;
  return { growing: slopeMbPerMin > 5, slopeMbPerMin: Math.round(slopeMbPerMin * 100) / 100 };
}

// ─────────────────────────────────────────────────────────────
// CONNECTION POOL SATURATION
// ─────────────────────────────────────────────────────────────
async function checkConnectionPoolSaturation(prisma: PrismaClient): Promise<{
  active: number; idle: number; max: number; saturationPct: number;
}> {
  const rows = await prisma.$queryRaw<{ state: string; count: string }[]>`
    SELECT state, COUNT(*) AS count FROM pg_stat_activity
    WHERE datname = current_database()
    GROUP BY state
  `;
  const active = parseInt(rows.find(r => r.state === 'active')?.count ?? '0');
  const idle   = parseInt(rows.find(r => r.state === 'idle')?.count   ?? '0');
  const maxRow = await prisma.$queryRaw<{ setting: string }[]>`SHOW max_connections`;
  const max    = parseInt(maxRow[0]?.setting ?? '100');
  const saturationPct = Math.round(((active + idle) / max) * 100);

  metrics.gauge('db.connection_saturation_pct', saturationPct);
  return { active, idle, max, saturationPct };
}

// ─────────────────────────────────────────────────────────────
// OVERLOAD PREDICTOR
// ─────────────────────────────────────────────────────────────
function predictOverloadRisk(opts: {
  p95Latency:      number;
  latencyBaseline: number;
  saturationPct:   number;
  errorRate:       number;
  memGrowthMbMin:  number;
}): { risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  if (opts.p95Latency > opts.latencyBaseline * 2) {
    score += 30; signals.push(`p95 latency ${opts.p95Latency}ms is 2x baseline`);
  } else if (opts.p95Latency > opts.latencyBaseline * 1.5) {
    score += 15; signals.push(`p95 latency elevated`);
  }

  if (opts.saturationPct > 85) {
    score += 35; signals.push(`DB connections at ${opts.saturationPct}%`);
  } else if (opts.saturationPct > 70) {
    score += 15;
  }

  if (opts.errorRate > 0.05) {
    score += 30; signals.push(`Error rate ${(opts.errorRate * 100).toFixed(1)}%`);
  } else if (opts.errorRate > 0.01) {
    score += 15;
  }

  if (opts.memGrowthMbMin > 10) {
    score += 20; signals.push(`Memory growing ${opts.memGrowthMbMin}MB/min`);
  }

  const risk = score >= 70 ? 'CRITICAL' : score >= 45 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW';
  return { risk, score, signals };
}

// ─────────────────────────────────────────────────────────────
// PERFORMANCE ENGINE RUNNER
// ─────────────────────────────────────────────────────────────
export class PerformanceEngine {
  private memTimer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaClient) {}

  startMemorySampler(): void {
    sampleMemory();
    this.memTimer = setInterval(sampleMemory, 60_000);
  }

  async runAnalysis(): Promise<void> {
    logger.info('[PERF] Running performance analysis...');

    try {
      const [slowQueries, indexSuggestions, connStats] = await Promise.all([
        detectSlowQueries(this.prisma),
        suggestIndexes(this.prisma),
        checkConnectionPoolSaturation(this.prisma),
      ]);

      const allLatencies   = latencyTracker.getAll();
      const worstEndpoint  = allLatencies.sort((a, b) => b.p95 - a.p95)[0];
      const memTrend       = detectMemoryGrowthTrend();
      const errorRate      = metrics.getGauge('http.error_rate');

      const overload = predictOverloadRisk({
        p95Latency:      worstEndpoint?.p95 ?? 0,
        latencyBaseline: worstEndpoint ? latencyTracker.getBaseline(worstEndpoint.endpoint) : 100,
        saturationPct:   connStats.saturationPct,
        errorRate,
        memGrowthMbMin:  memTrend.slopeMbPerMin,
      });

      metrics.gauge('perf.overload_score', overload.score);

      // Persist observation
      if (worstEndpoint) {
        await this.prisma.$executeRaw`
          INSERT INTO perf_observations (endpoint, p95_ms, p99_ms, sample_count, index_suggestion)
          VALUES (${worstEndpoint.endpoint}, ${worstEndpoint.p95}, ${worstEndpoint.p99},
                  ${worstEndpoint.samples},
                  ${indexSuggestions.slice(0, 3).join('\n') || null})
        `;
      }

      // Alert on slow queries
      if (slowQueries.length > 0) {
        await alertWebhook({
          severity: 'MEDIUM',
          title:    `${slowQueries.length} slow DB queries detected`,
          body:     slowQueries.slice(0, 5).map(q =>
            `[${q.mean_ms}ms avg, ${q.calls} calls] ${q.query.slice(0, 150)}`
          ).join('\n\n'),
        });
      }

      // Alert on connection saturation
      if (connStats.saturationPct > 80) {
        await alertWebhook({
          severity: connStats.saturationPct > 90 ? 'CRITICAL' : 'HIGH',
          title:    `DB connection pool at ${connStats.saturationPct}%`,
          body:     `Active: ${connStats.active}, Idle: ${connStats.idle}, Max: ${connStats.max}`,
        });
      }

      // Alert on memory growth
      if (memTrend.growing) {
        await alertWebhook({
          severity: 'MEDIUM',
          title:    `Memory growth detected: +${memTrend.slopeMbPerMin}MB/min`,
          body:     `Current heap: ${memSamples.at(-1)?.mb ?? 0}MB`,
        });
      }

      // Create incident for critical overload risk
      if (overload.risk === 'CRITICAL') {
        await incidentManager.createIncident({
          priority: 'P2',
          title:    'Overload risk: CRITICAL',
          details:  { ...overload, connStats, memTrend },
        });
      }

      logger.info('[PERF] Analysis complete', {
        overloadRisk:    overload.risk,
        saturationPct:   connStats.saturationPct,
        slowQueries:     slowQueries.length,
        indexSuggestions: indexSuggestions.length,
      });
    } catch (err) {
      logger.error('[PERF] Analysis failed', { err });
    }
  }

  stop(): void {
    clearInterval(this.memTimer);
  }
}
