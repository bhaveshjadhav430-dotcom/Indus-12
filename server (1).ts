// apps/api/src/server.ts
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

import { authRoutes } from './routes/auth.js';
import { salesRoutes } from './routes/sales.js';
import { inventoryRoutes } from './routes/inventory.js';
import { customerRoutes } from './routes/customers.js';
import { reportRoutes } from './routes/reports.js';
import { shopRoutes } from './routes/shops.js';

const PORT = parseInt(process.env.PORT || process.env.API_PORT || '4000');
const HOST = process.env.API_HOST || '0.0.0.0';

// ─── Prisma ──────────────────────────────────────────────────
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

// ─── Redis ───────────────────────────────────────────────────
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 2000),
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

// ─── Fastify ─────────────────────────────────────────────────
const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    ...(process.env.NODE_ENV !== 'production' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  },
  trustProxy: true,
});

await app.register(fastifyHelmet, {
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

await app.register(fastifyCors, {
  origin: [
    process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    process.env.NEXT_PUBLIC_ERP_API_URL || 'http://localhost:3001',
    'http://localhost:3000',
    'http://localhost:3001',
  ],
  credentials: true,
});

await app.register(fastifyRateLimit, {
  max: 200,
  timeWindow: '1 minute',
  redis,
  keyGenerator: (req) => req.ip,
});

await app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'CHANGE_THIS_SECRET_IN_PRODUCTION_MIN_64_CHARS',
  sign: { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
});

// ─── Decorators ──────────────────────────────────────────────
app.decorate('authenticate', async (request: any, reply: any) => {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});

app.decorate('requireAdmin', async (request: any, reply: any) => {
  try {
    await request.jwtVerify();
    if (request.user.role !== 'ADMIN') {
      reply.code(403).send({ error: 'Admin access required' });
    }
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});

// ─── Health Endpoints ────────────────────────────────────────
app.get('/health', async (_req, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: { database: 'ok', redis: redis.status === 'ready' ? 'ok' : 'degraded' },
    });
  } catch (err) {
    return reply.code(503).send({ status: 'error', error: 'Database unavailable' });
  }
});

app.get('/health/deep', { preHandler: [app.authenticate] }, async (_req, reply) => {
  const [dbResult, redisResult] = await Promise.allSettled([
    prisma.$queryRaw`SELECT COUNT(*) FROM "Sale"`,
    redis.ping(),
  ]);

  const dbOk = dbResult.status === 'fulfilled';
  const redisOk = redisResult.status === 'fulfilled';

  return reply.code(dbOk ? 200 : 503).send({
    status: dbOk ? 'ok' : 'degraded',
    database: dbOk ? 'ok' : 'error',
    redis: redisOk ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

// ─── Routes ──────────────────────────────────────────────────
await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(salesRoutes, { prefix: '/api/sales' });
await app.register(inventoryRoutes, { prefix: '/api/inventory' });
await app.register(customerRoutes, { prefix: '/api/customers' });
await app.register(reportRoutes, { prefix: '/api/reports' });
await app.register(shopRoutes, { prefix: '/api/shops' });

// ─── Start ───────────────────────────────────────────────────
const start = async () => {
  try {
    await redis.connect().catch(() => {
      console.warn('[Redis] Could not connect — idempotency disabled');
    });

    await app.listen({ port: PORT, host: HOST });
    console.log(`✅ API running on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  await app.close();
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();

export default app;
