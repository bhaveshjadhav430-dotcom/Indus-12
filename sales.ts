// apps/api/src/routes/sales.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../server.js';
import { idempotencyMiddleware, cacheIdempotencyResponse } from '../middleware/idempotency.js';

function generateInvoice(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `INV-${yy}${mm}${dd}-${rand}`;
}

const confirmSaleSchema = z.object({
  shopId: z.string(),
  customerId: z.string().optional(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
    unitPricePaise: z.number().int().positive(),
    discountPaise: z.number().int().min(0).default(0),
  })).min(1),
  payments: z.array(z.object({
    mode: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CREDIT']),
    amountPaise: z.number().int().positive(),
    reference: z.string().optional(),
  })).min(1),
  discountPaise: z.number().int().min(0).default(0),
  notes: z.string().optional(),
});

export async function salesRoutes(app: FastifyInstance) {

  // GET /api/sales?shopId=&status=&page=&limit=
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const q = request.query as any;
    const user = request.user as any;
    const shopId = user.role === 'ADMIN' ? q.shopId : user.shopId;

    if (!shopId) return reply.code(400).send({ error: 'shopId required' });

    const page = Math.max(1, parseInt(q.page || '1'));
    const limit = Math.min(100, parseInt(q.limit || '20'));
    const skip = (page - 1) * limit;

    const where: any = { shopId };
    if (q.status) where.status = q.status;
    if (q.customerId) where.customerId = q.customerId;
    if (q.from || q.to) {
      where.confirmedAt = {};
      if (q.from) where.confirmedAt.gte = new Date(q.from);
      if (q.to) where.confirmedAt.lte = new Date(q.to);
    }

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          createdBy: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.sale.count({ where }),
    ]);

    return reply.send({ data: sales, total, page, limit, pages: Math.ceil(total / limit) });
  });

  // GET /api/sales/:id
  app.get('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    const user = request.user as any;

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        customer: true,
        createdBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
        payments: true,
      },
    });

    if (!sale) return reply.code(404).send({ error: 'Sale not found' });
    if (user.role !== 'ADMIN' && sale.shopId !== user.shopId) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    return reply.send({ sale });
  });

  // POST /api/sales — confirm sale (atomic with stock deduction)
  app.post('/', {
    preHandler: [app.authenticate, idempotencyMiddleware],
    preSerialization: [cacheIdempotencyResponse],
  }, async (request, reply) => {
    const user = request.user as any;
    const body = confirmSaleSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Validation error', details: body.error.flatten() });

    const { shopId, customerId, items, payments, discountPaise = 0, notes } = body.data;

    // Shop access check
    if (user.role !== 'ADMIN' && shopId !== user.shopId) {
      return reply.code(403).send({ error: 'Cannot create sale for another shop' });
    }

    // ─── Atomic transaction ───────────────────────────────────
    const sale = await prisma.$transaction(async (tx) => {
      // 1. Validate and lock stock for all items
      const stockChecks = await Promise.all(
        items.map((item) =>
          tx.stockLedger.findUnique({
            where: { shopId_productId: { shopId, productId: item.productId } },
          })
        )
      );

      for (let i = 0; i < items.length; i++) {
        const stock = stockChecks[i];
        const item = items[i];
        if (!stock) {
          throw Object.assign(new Error(`Product ${item.productId} not found in shop stock`), { statusCode: 404 });
        }
        if (stock.quantityOnHand < item.quantity) {
          throw Object.assign(
            new Error(`Insufficient stock for product. Available: ${stock.quantityOnHand}, requested: ${item.quantity}`),
            { statusCode: 422 }
          );
        }
      }

      // 2. Calculate totals
      const lineItems = items.map((item) => {
        const lineTotal = item.quantity * item.unitPricePaise - item.discountPaise;
        return { ...item, lineTotalPaise: lineTotal };
      });
      const subtotal = lineItems.reduce((s, li) => s + li.lineTotalPaise, 0);
      const totalAmount = subtotal - discountPaise;

      // 3. Payment validation
      const totalPaid = payments.reduce((s, p) => s + p.amountPaise, 0);
      const creditPayments = payments.filter((p) => p.mode === 'CREDIT');
      const creditAmount = creditPayments.reduce((s, p) => s + p.amountPaise, 0);
      const cashAmount = totalPaid - creditAmount;

      if (cashAmount + creditAmount !== totalAmount) {
        if (totalPaid < totalAmount) {
          throw Object.assign(new Error(`Payment shortfall: ₹${((totalAmount - totalPaid) / 100).toFixed(2)} remaining`), { statusCode: 422 });
        }
      }

      // 4. Credit limit check
      if (creditAmount > 0) {
        if (!customerId) {
          throw Object.assign(new Error('Customer required for credit sale'), { statusCode: 422 });
        }
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer) throw Object.assign(new Error('Customer not found'), { statusCode: 404 });

        // Calculate current outstanding credit
        const outstanding = await tx.sale.aggregate({
          where: { customerId, status: 'CONFIRMED', creditAmountPaise: { gt: 0 } },
          _sum: { creditAmountPaise: true },
        });
        const currentCredit = outstanding._sum.creditAmountPaise || 0;

        // Credit payments received
        const creditReceived = await tx.creditPayment.aggregate({
          where: { customerId },
          _sum: { amountPaise: true },
        });
        const received = creditReceived._sum.amountPaise || 0;
        const netOutstanding = currentCredit - received;

        if (netOutstanding + creditAmount > customer.creditLimitPaise) {
          throw Object.assign(
            new Error(`Credit limit exceeded. Limit: ₹${(customer.creditLimitPaise / 100).toFixed(2)}, Net outstanding: ₹${(netOutstanding / 100).toFixed(2)}, Requested: ₹${(creditAmount / 100).toFixed(2)}`),
            { statusCode: 422 }
          );
        }
      }

      // 5. Create sale
      let invoiceNumber: string;
      let attempts = 0;
      do {
        invoiceNumber = generateInvoice();
        attempts++;
        if (attempts > 10) throw new Error('Could not generate unique invoice number');
      } while (await tx.sale.findUnique({ where: { invoiceNumber } }));

      const newSale = await tx.sale.create({
        data: {
          invoiceNumber,
          shopId,
          customerId,
          createdById: user.sub,
          status: 'CONFIRMED',
          subtotalPaise: subtotal,
          discountPaise,
          totalAmountPaise: totalAmount,
          paidAmountPaise: cashAmount,
          creditAmountPaise: creditAmount,
          notes,
          confirmedAt: new Date(),
          items: {
            create: lineItems.map((li) => ({
              productId: li.productId,
              quantity: li.quantity,
              unitPricePaise: li.unitPricePaise,
              discountPaise: li.discountPaise,
              lineTotalPaise: li.lineTotalPaise,
            })),
          },
          payments: {
            create: payments.map((p) => ({
              mode: p.mode,
              amountPaise: p.amountPaise,
              reference: p.reference,
            })),
          },
        },
        include: {
          items: { include: { product: { select: { name: true, sku: true } } } },
          payments: true,
          customer: { select: { name: true, phone: true } },
        },
      });

      // 6. Deduct stock and record movements
      await Promise.all(
        items.map(async (item) => {
          const ledger = await tx.stockLedger.update({
            where: { shopId_productId: { shopId, productId: item.productId } },
            data: { quantityOnHand: { decrement: item.quantity } },
          });

          // Enforce non-negative after update (belt + suspenders)
          if (ledger.quantityOnHand < 0) {
            throw Object.assign(new Error('Stock went negative — concurrent sale conflict'), { statusCode: 409 });
          }

          await tx.stockMovement.create({
            data: {
              stockLedgerId: ledger.id,
              type: 'SALE',
              quantityDelta: -item.quantity,
              referenceId: newSale.id,
              note: `Sale ${newSale.invoiceNumber}`,
            },
          });
        })
      );

      return newSale;
    }, { timeout: 15000 });

    return reply.code(201).send({ sale });
  });

  // POST /api/sales/:id/void
  app.post('/:id/void', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    const user = request.user as any;
    const schema = z.object({ reason: z.string().min(3) });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Reason required (min 3 chars)' });

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!sale) return reply.code(404).send({ error: 'Sale not found' });
    if (user.role !== 'ADMIN' && sale.shopId !== user.shopId) {
      return reply.code(403).send({ error: 'Access denied' });
    }
    if (sale.status !== 'CONFIRMED') {
      return reply.code(422).send({ error: `Cannot void a sale with status: ${sale.status}` });
    }

    const voided = await prisma.$transaction(async (tx) => {
      const voided = await tx.sale.update({
        where: { id },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: body.data.reason },
      });

      // Return stock
      await Promise.all(
        sale.items.map(async (item) => {
          const ledger = await tx.stockLedger.findFirst({
            where: { shopId: sale.shopId, productId: item.productId },
          });
          if (!ledger) return;

          await tx.stockLedger.update({
            where: { id: ledger.id },
            data: { quantityOnHand: { increment: item.quantity } },
          });

          await tx.stockMovement.create({
            data: {
              stockLedgerId: ledger.id,
              type: 'VOID_RETURN',
              quantityDelta: item.quantity,
              referenceId: sale.id,
              note: `Void: ${body.data.reason}`,
            },
          });
        })
      );

      return voided;
    });

    return reply.send({ sale: voided });
  });
}
