// apps/api/src/routes/shops.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../server.js';

export async function shopRoutes(app: FastifyInstance) {

  // GET /api/shops
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    const where = user.role === 'ADMIN' ? {} : { id: user.shopId };
    const shops = await prisma.shop.findMany({
      where,
      include: { _count: { select: { users: true, sales: true } } },
      orderBy: { name: 'asc' },
    });
    return reply.send({ data: shops });
  });

  // GET /api/shops/:id
  app.get('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    const shop = await prisma.shop.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, name: true, email: true, role: true, isActive: true } },
      },
    });
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });
    return reply.send({ shop });
  });

  // POST /api/shops (admin only)
  app.post('/', { preHandler: [app.requireAdmin] }, async (request, reply) => {
    const schema = z.object({
      name: z.string().min(3),
      address: z.string().min(5),
      phone: z.string().optional(),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Validation error', details: body.error.flatten() });
    const shop = await prisma.shop.create({ data: body.data });
    return reply.code(201).send({ shop });
  });

  // GET /api/shops/:id/users (admin only)
  app.get('/:id/users', { preHandler: [app.requireAdmin] }, async (request, reply) => {
    const { id } = request.params as any;
    const users = await prisma.user.findMany({
      where: { shopId: id },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });
    return reply.send({ data: users });
  });

  // POST /api/shops/:id/users (admin only)
  app.post('/:id/users', { preHandler: [app.requireAdmin] }, async (request, reply) => {
    const { id } = request.params as any;
    const schema = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8),
      role: z.enum(['ADMIN', 'SHOP_MANAGER']).default('SHOP_MANAGER'),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Validation error', details: body.error.flatten() });

    const existing = await prisma.user.findUnique({ where: { email: body.data.email } });
    if (existing) return reply.code(409).send({ error: 'Email already registered' });

    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(body.data.password, 10);

    const user = await prisma.user.create({
      data: { name: body.data.name, email: body.data.email, passwordHash, role: body.data.role, shopId: id },
      select: { id: true, name: true, email: true, role: true },
    });
    return reply.code(201).send({ user });
  });
}
