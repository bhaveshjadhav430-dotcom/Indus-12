/**
 * workers/cron-scheduler.ts
 * All background workers and cron jobs registered here.
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { metrics } from '../monitoring/metrics';
import { InvariantEngine } from '../autonomous/invariant-engine';
import { PerformanceEngine } from '../autonomous/performance-engine';
import { SecurityEngine } from '../autonomous/security-engine';
import { HealthScoreEngine } from '../autonomous/health-score';
import { runBackupValidation } from '../autonomous/backup-validator';
import { generateExecutiveSummary } from '../autonomous/executive-summary';
import { IdempotencyRegistry } from '../autonomous/self-healing-core';

const INTERVALS = {
  INVARIANT_CHECK:   parseInt(process.env.INVARIANT_INTERVAL_MS   ?? String(5  * 60 * 1000)),  // 5 min
  PERF_ANALYSIS:     parseInt(process.env.PERF_INTERVAL_MS         ?? String(10 * 60 * 1000)),  // 10 min
  SECURITY_SCAN:     parseInt(process.env.SECURITY_INTERVAL_MS     ?? String(15 * 60 * 1000)),  // 15 min
  HEALTH_SCORE:      parseInt(process.env.HEALTH_INTERVAL_MS       ?? String(5  * 60 * 1000)),  // 5 min
  BACKUP_VALIDATION: parseInt(process.env.BACKUP_INTERVAL_MS       ?? String(24 * 60 * 60 * 1000)), // 24h
  EXECUTIVE_REPORT:  parseInt(process.env.EXEC_REPORT_INTERVAL_MS  ?? String(24 * 60 * 60 * 1000)), // 24h
  IDEMPOTENCY_CLEAN: parseInt(process.env.IDEMPOTENCY_CLEAN_MS     ?? String(60 * 60 * 1000)),  // 1h
  RATE_LIMITER_CLEAN:15 * 60 * 1000, // 15 min
};

interface Job {
  name:       string;
  intervalMs: number;
  runOnStart: boolean;
  fn:         () => Promise<void>;
  timer?:     NodeJS.Timeout;
  lastRun?:   Date;
  lastError?: string;
  runCount:   number;
}

class CronScheduler {
  private jobs: Map<string, Job> = new Map();

  register(job: Omit<Job, 'runCount' | 'timer'>): void {
    this.jobs.set(job.name, { ...job, runCount: 0 });
  }

  async start(): Promise<void> {
    for (const [name, job] of this.jobs) {
      logger.info(`[CRON] Scheduling ${name} every ${job.intervalMs / 1000}s`);

      const run = async () => {
        const start = Date.now();
        try {
          await job.fn();
          job.lastRun   = new Date();
          job.lastError = undefined;
          job.runCount++;
          metrics.gauge(`cron.${name}.last_run_ms`, Date.now() - start);
          metrics.increment(`cron.${name}.success_total`);
        } catch (err: any) {
          job.lastError = err.message;
          logger.error(`[CRON] ${name} failed`, { err });
          metrics.increment(`cron.${name}.error_total`);
        }
      };

      if (job.runOnStart) {
        // Stagger startup to avoid thundering herd
        const stagger = Math.random() * 10_000;
        setTimeout(run, stagger);
      }

      job.timer = setInterval(run, job.intervalMs);
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      if (job.timer) clearInterval(job.timer);
    }
  }

  status(): Array<{ name: string; lastRun?: string; lastError?: string; runCount: number }> {
    return Array.from(this.jobs.values()).map(j => ({
      name:      j.name,
      lastRun:   j.lastRun?.toISOString(),
      lastError: j.lastError,
      runCount:  j.runCount,
    }));
  }
}

export const cronScheduler = new CronScheduler();

export function initCronScheduler(
  prisma:          PrismaClient,
  perfEngine:      PerformanceEngine,
  securityEngine:  SecurityEngine,
  healthEngine:    HealthScoreEngine,
  idempotency:     IdempotencyRegistry,
): void {
  const invariantEngine = new InvariantEngine(prisma);

  // RateLimiter already handles cleanup internally via clear interval
  const { rateLimiter } = require('../autonomous/security-engine');

  cronScheduler.register({
    name:       'invariant-check',
    intervalMs: INTERVALS.INVARIANT_CHECK,
    runOnStart: true,
    fn:         () => invariantEngine.runAll().then(() => {}),
  });

  cronScheduler.register({
    name:       'performance-analysis',
    intervalMs: INTERVALS.PERF_ANALYSIS,
    runOnStart: true,
    fn:         () => perfEngine.runAnalysis(),
  });

  cronScheduler.register({
    name:       'security-scan',
    intervalMs: INTERVALS.SECURITY_SCAN,
    runOnStart: false,
    fn:         () => securityEngine.runFullScan(),
  });

  cronScheduler.register({
    name:       'health-score',
    intervalMs: INTERVALS.HEALTH_SCORE,
    runOnStart: true,
    fn:         () => healthEngine.compute().then(() => {}),
  });

  cronScheduler.register({
    name:       'backup-validation',
    intervalMs: INTERVALS.BACKUP_VALIDATION,
    runOnStart: false, // run at configured time via env or first time only
    fn:         () => runBackupValidation(prisma),
  });

  cronScheduler.register({
    name:       'executive-report',
    intervalMs: INTERVALS.EXECUTIVE_REPORT,
    runOnStart: false,
    fn:         () => generateExecutiveSummary(prisma).then(() => {}),
  });

  cronScheduler.register({
    name:       'idempotency-cleanup',
    intervalMs: INTERVALS.IDEMPOTENCY_CLEAN,
    runOnStart: false,
    fn:         () => idempotency.cleanup(),
  });

  cronScheduler.register({
    name:       'rate-limiter-cleanup',
    intervalMs: INTERVALS.RATE_LIMITER_CLEAN,
    runOnStart: false,
    fn:         async () => { rateLimiter.cleanup(); },
  });
}
