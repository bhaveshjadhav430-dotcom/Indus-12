// apps/api/src/middleware/idempotency.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../server.js';

const IDEMPOTENCY_TTL = 86400; // 24 hours

export async function idempotencyMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const key = request.headers['idempotency-key'] as string | undefined;
  if (!key) return;
  if (!['POST', 'PUT', 'PATCH'].includes(request.method)) return;

  // Only proceed if Redis is available
  if (redis.status !== 'ready') return;

  const cacheKey = `idem:${key}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const { statusCode, body } = JSON.parse(cached);
      reply.header('X-Idempotency-Cache', 'hit');
      return reply.code(statusCode).send(body);
    }

    // Store the hook to cache response after handler runs
    reply.addHook = reply.addHook || (() => {});
    (request as any)._idempotencyKey = cacheKey;
  } catch {
    // Redis failure — allow request through without idempotency
  }
}

export async function cacheIdempotencyResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown
) {
  const cacheKey = (request as any)._idempotencyKey;
  if (!cacheKey || redis.status !== 'ready') return payload;

  try {
    await redis.setex(
      cacheKey,
      IDEMPOTENCY_TTL,
      JSON.stringify({ statusCode: reply.statusCode, body: payload })
    );
  } catch {
    // Ignore Redis failures
  }

  return payload;
}
