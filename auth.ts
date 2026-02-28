// apps/api/src/routes/auth.ts
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../server.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid input', details: body.error.flatten() });

    const user = await prisma.user.findUnique({
      where: { email: body.data.email },
      include: { shop: { select: { id: true, name: true } } },
    });

    if (!user || !user.isActive) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(body.data.password, user.passwordHash);
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' });

    const token = app.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
      name: user.name,
    });

    return reply.send({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        shop: user.shop,
      },
    });
  });

  // GET /api/auth/me
  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const payload = request.user as any;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, shopId: true, shop: { select: { id: true, name: true } } },
    });
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return reply.send({ user });
  });

  // POST /api/auth/change-password
  app.post('/change-password', { preHandler: [app.authenticate] }, async (request, reply) => {
    const schema = z.object({ currentPassword: z.string(), newPassword: z.string().min(8) });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' });

    const payload = request.user as any;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const valid = await bcrypt.compare(body.data.currentPassword, user.passwordHash);
    if (!valid) return reply.code(401).send({ error: 'Current password incorrect' });

    const hash = await bcrypt.hash(body.data.newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    return reply.send({ message: 'Password changed successfully' });
  });
}
