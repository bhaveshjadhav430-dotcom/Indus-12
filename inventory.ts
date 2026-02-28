// apps/api/src/routes/inventory.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../server.js';

export async function inventoryRoutes(app: FastifyInstance) {

  // GET /api/inventory/stock?shopId=
  app.get('/stock', { preHandler: [app.authenticate] }, async (request, reply) => {
    const q = request.query as any;
    const user = request.user as any;
    const shopId = user.role === 'ADMIN' ? q.shopId : user.shopId;
    if (!shopId) return reply.code(400).send({ error: 'shopId required' });

    const where: any = { shopId };
    if (q.categoryId) where.product = { categoryId: q.categoryId };
    if (q.lowStock === 'true') where.quantityOnHand = { lte: prisma.stockLedger.fields.reorderLevel };
    if (q.search) where.product = { ...where.product, name: { contains: q.search, mode: 'insensitive' } };

    const stock = await prisma.stockLedger.findMany({
      where,
      include: {
        product: { include: { category: { select: { id: true, name: true } } } },
      },
      orderBy: { product: { name: 'asc' } },
    });

    // Add low-stock flag
    const enriched = stock.map((s) => ({
      ...s,
      isLowStock: s.quantityOnHand <= s.reorderLevel,
    }));

    return reply.send({ data: enriched });
  });

  // GET /api/inventory/products
  app.get('/products', { preHandler: [app.authenticate] }, async (_request, reply) => {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    return reply.send({ data: products });
  });

  // GET /api/inventory/categories
  app.get('/categories', { preHandler: [app.authenticate] }, async (_request, reply) => {
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    return reply.send({ data: categories });
  });

  // POST /api/inventory/products (admin only)
  app.post('/products', { preHandler: [app.requireAdmin] }, async (request, reply) => {
    const schema = z.object({
      name: z.string().min(2),
      sku: z.string().min(2),
      description: z.string().optional(),
      unit: z.string().default('pc'),
      categoryId: z.string(),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Validation error', details: body.error.flatten() });

    const existing = await prisma.product.findUnique({ where: { sku: body.data.sku } });
    if (existing) return reply.code(409).send({ error: 'SKU already exists' });

    const product = await prisma.product.create({ data: body.data, include: { category: true } });
    return reply.code(201).send({ product });
  });

  // PUT /api/inventory/stock/:stockLedgerId — update price/reorder
  app.put('/stock/:id', { preHandler: [app.requireAdmin] }, async (request, reply) => {
    const { id } = request.params as any;
    const schema = z.object({
      salePricePaise: z.number().int().positive().optional(),
      costPricePaise: z.number().int().positive().optional(),
      reorderLevel: z.number().int().min(0).optional(),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Validation error' });

    const updated = await prisma.stockLedger.update({ where: { id }, data: body.data });
    return reply.send({ stock: updated });
  });

  // POST /api/inventory/adjust — stock adjustment
  app.post('/adjust', { preHandler: [app.authenticate] }, async (request, reply) => {
    const schema = z.object({
      shopId: z.string(),
      productId: z.string(),
      delta: z.number().int().refine((n) => n !== 0, 'Delta cannot be zero'),
      reason: z.string().min(3),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Validation error', details: body.error.flatten() });

    const user = request.user as any;
    if (user.role !== 'ADMIN' && body.data.shopId !== user.shopId) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const ledger = await tx.stockLedger.findUnique({
        where: { shopId_productId: { shopId: body.data.shopId, productId: body.data.productId } },
      });
      if (!ledger) throw Object.assign(new Error('Stock record not found'), { statusCode: 404 });

      const newQty = ledger.quantityOnHand + body.data.delta;
      if (newQty < 0) {
        throw Object.assign(
          new Error(`Adjustment would result in negative stock (${ledger.quantityOnHand} + ${body.data.delta} = ${newQty})`),
          { statusCode: 422 }
        );
      }

      const updated = await tx.stockLedger.update({
        where: { id: ledger.id },
        data: { quantityOnHand: { increment: body.data.delta } },
      });

      await tx.stockMovement.create({
        data: {
          stockLedgerId: ledger.id,
          type: 'ADJUSTMENT',
          quantityDelta: body.data.delta,
          note: body.data.reason,
        },
      });

      await tx.stockAdjustment.create({
        data: {
          shopId: body.data.shopId,
          stockLedgerId: ledger.id,
          userId: user.sub,
          delta: body.data.delta,
          reason: body.data.reason,
        },
      });

      return updated;
    });

    return reply.send({ stock: result });
  });

  // GET /api/inventory/movements?stockLedgerId=
  app.get('/movements', { preHandler: [app.authenticate] }, async (request, reply) => {
    const q = request.query as any;
    if (!q.stockLedgerId) return reply.code(400).send({ error: 'stockLedgerId required' });

    const movements = await prisma.stockMovement.findMany({
      where: { stockLedgerId: q.stockLedgerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return reply.send({ data: movements });
  });

  // POST /api/inventory/purchase — add stock from purchase
  app.post('/purchase', { preHandler: [app.requireAdmin] }, async (request, reply) => {
    const schema = z.object({
      shopId: z.string(),
      items: z.array(z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
        costPricePaise: z.number().int().positive().optional(),
      })).min(1),
      note: z.string().optional(),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Validation error', details: body.error.flatten() });

    const results = await prisma.$transaction(async (tx) => {
      return Promise.all(body.data.items.map(async (item) => {
        const ledger = await tx.stockLedger.findUnique({
          where: { shopId_productId: { shopId: body.data.shopId, productId: item.productId } },
        });
        if (!ledger) throw Object.assign(new Error(`Product ${item.productId} not in shop`), { statusCode: 404 });

        const updated = await tx.stockLedger.update({
          where: { id: ledger.id },
          data: {
            quantityOnHand: { increment: item.quantity },
            ...(item.costPricePaise && { costPricePaise: item.costPricePaise }),
          },
        });

        await tx.stockMovement.create({
          data: {
            stockLedgerId: ledger.id,
            type: 'PURCHASE',
            quantityDelta: item.quantity,
            note: body.data.note || 'Purchase stock addition',
          },
        });

        return updated;
      }));
    });

    return reply.code(201).send({ updated: results.length, results });
  });
}
