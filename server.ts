/**
 * src/server.ts — Autonomous Platform Bootstrap
 * Wires all autonomous systems into the Fastify server.
 */
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { logger }           from './config/logger';
import { metrics }          from './monitoring/metrics';
import { alertWebhook }     from './monitoring/alerts';

// Autonomous modules
import { incidentManager }              from './autonomous/incident-manager';
import { InvariantEngine }              from './autonomous/invariant-engine';
import { PerformanceEngine, latencyTracker } from './autonomous/performance-engine';
import { SecurityEngine, securityMiddleware } from './autonomous/security-engine';
import { HealthScoreEngine, safeModeMiddleware } from './autonomous/health-score';
import { IdempotencyRegistry, dbCircuitBreaker } from './autonomous/self-healing-core';
import { runDeploymentGates }           from './autonomous/deployment-gates';
import { generateExecutiveSummary }     from './autonomous/executive-summary';
import { cronScheduler, initCronScheduler } from './workers/cron-scheduler';

const PORT         = parseInt(process.env.PORT         ?? '3000');
const DATABASE_URL = process.env.DATABASE_URL          ?? '';
const REDIS_URL    = process.env.REDIS_URL             ?? '';

async function bootstrap(): Promise<void> {
  logger.info('[BOOT] Starting Autonomous Platform...');

  // ── 1. Database ──────────────────────────────────────────
  const prisma = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'query' },
    ],
  });

  (prisma as any).$on('query', (e: any) => {
    metrics.histogram('db.query_duration_ms', e.duration);
    if (e.duration > 1000) logger.warn('[DB] Slow query', { duration: e.duration, query: e.query.slice(0, 200) });
  });

  await dbCircuitBreaker.call(() => prisma.$connect());
  logger.info('[BOOT] DB connected');

  // ── 2. Redis ─────────────────────────────────────────────
  let redis: any = null;
  if (REDIS_URL) {
    redis = createClient({ url: REDIS_URL });
    redis.on('error', (err: any) => logger.error('[REDIS] Error', { err }));
    await redis.connect();
    logger.info('[BOOT] Redis connected');
  }

  // ── 3. Init autonomous modules ───────────────────────────
  incidentManager.init(prisma);

  const perfEngine     = new PerformanceEngine(prisma);
  const securityEngine = new SecurityEngine(prisma);
  const healthEngine   = new HealthScoreEngine(prisma);
  const idempotency    = new IdempotencyRegistry(prisma);

  perfEngine.startMemorySampler();

  // ── 4. Deployment gates (non-test) ───────────────────────
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
    await runDeploymentGates(prisma, 'bootstrap');
  }

  // ── 5. Fastify ───────────────────────────────────────────
  const app = Fastify({
    logger:   false,
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  // ── 6. Latency tracking hook ─────────────────────────────
  app.addHook('onResponse', (req, reply, done) => {
    latencyTracker.record(req.routerPath ?? req.url, reply.elapsedTime ?? 0);
    done();
  });

  // ── 7. Safe mode middleware ──────────────────────────────
  app.addHook('preHandler', safeModeMiddleware(healthEngine) as any);

  // ── 8. Security middleware ───────────────────────────────
  app.addHook('preHandler', securityMiddleware(prisma, securityEngine) as any);

  // ── 9. Metrics middleware ────────────────────────────────
  let totalReq = 0, errorReq = 0;
  app.addHook('onRequest', (_req, _rep, done) => { totalReq++; done(); });
  app.addHook('onResponse', (req, reply, done) => {
    if (reply.statusCode >= 500) errorReq++;
    metrics.gauge('http.error_rate', totalReq > 0 ? errorReq / totalReq : 0);
    metrics.histogram('http.request_duration_ms', reply.elapsedTime ?? 0, {
      method: req.method, route: req.routerPath ?? req.url, status: String(reply.statusCode),
    });
    done();
  });

  // ── 10. System health endpoint ───────────────────────────
  app.get('/system-health', async () => {
    return healthEngine.compute();
  });

  // ── 11. Safe mode control ────────────────────────────────
  app.post('/system-mode/safe', async (req: any) => {
    const { reason, enabledBy } = req.body ?? {};
    await healthEngine.enableSafeMode(reason ?? 'Manual', enabledBy ?? 'api');
    return { safeMode: true, reason };
  });

  app.delete('/system-mode/safe', async (req: any) => {
    const { overrideToken, disabledBy } = req.body ?? {};
    const ok = await healthEngine.disableSafeMode(overrideToken, disabledBy ?? 'api');
    if (!ok) return { success: false, message: 'Invalid override token' };
    return { safeMode: false };
  });

  // ── 12. Incident endpoints ───────────────────────────────
  app.get('/incidents', async () => {
    const summary = await incidentManager.getIncidentSummary();
    const open    = await prisma.$queryRaw`
      SELECT id, priority, status, title, invariant, created_at, escalated_at
      FROM incidents WHERE status NOT IN ('RESOLVED','CLOSED')
      ORDER BY
        CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT 50
    `;
    return { summary, open };
  });

  // ── 13. Invariant status ─────────────────────────────────
  app.get('/invariants/status', async () => {
    const engine  = new InvariantEngine(prisma);
    const drift   = await engine.getDriftScore();
    const recent  = await prisma.$queryRaw`
      SELECT invariant, COUNT(*) AS count, MAX(created_at) AS last_seen
      FROM invariant_violations
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY invariant ORDER BY count DESC
    `;
    return { driftScore: drift, last24h: recent };
  });

  // ── 14. Cron status ──────────────────────────────────────
  app.get('/cron/status', async () => cronScheduler.status());

  // ── 15. Metrics endpoints ────────────────────────────────
  app.get('/metrics', { logLevel: 'silent' }, async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return metrics.prometheusExport();
  });

  app.get('/metrics/json', { logLevel: 'silent' }, async () => ({
    timestamp: new Date().toISOString(),
    metrics:   metrics.snapshot(),
  }));

  // ── 16. Executive report trigger ─────────────────────────
  app.post('/reports/executive', async () => {
    const report = await generateExecutiveSummary(prisma);
    return report;
  });

  // ── 17. Health ───────────────────────────────────────────
  app.get('/health', async () => ({
    status:    'ok',
    db:        'connected',
    redis:     redis ? 'connected' : 'disabled',
    uptime:    process.uptime(),
    memory:    process.memoryUsage(),
    timestamp: new Date().toISOString(),
  }));

  // ── 18. Start cron scheduler ─────────────────────────────
  initCronScheduler(prisma, perfEngine, securityEngine, healthEngine, idempotency);
  await cronScheduler.start();

  // ── 19. Graceful shutdown ────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`[BOOT] ${signal} received`);
    cronScheduler.stop();
    perfEngine.stop();
    await app.close();
    await prisma.$disconnect();
    if (redis) await redis.quit();
    logger.info('[BOOT] Shutdown complete');
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', async (err) => {
    logger.fatal('[BOOT] Uncaught exception', { err });
    await alertWebhook({ severity: 'CRITICAL', title: 'Uncaught Exception', body: err.message });
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    logger.fatal('[BOOT] Unhandled rejection', { reason });
    await alertWebhook({ severity: 'CRITICAL', title: 'Unhandled Rejection', body: String(reason) });
    process.exit(1);
  });

  // ── 20. Listen ───────────────────────────────────────────
  await app.listen({ port: PORT, host: '0.0.0.0' });
  metrics.gauge('app.started_at', Date.now());
  logger.info(`[BOOT] ✅ Autonomous Platform ready on port ${PORT}`);
}

bootstrap().catch(err => {
  console.error('[BOOT] Fatal', err);
  process.exit(1);
});
