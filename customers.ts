// apps/api/src/routes/customers.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../server.js';

export async function customerRoutes(app: FastifyInstance) {

  // GET /api/customers
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const q = request.query as any;
    const where: any = {};
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: q.search } },
      ];
    }

    const customers = await prisma.customer.findMany({
      where,
      include: {
        _count: { select: { sales: true } },
      },
      orderBy: { name: 'asc' },
      take: 100,
    });

    // Compute outstanding credit for each
    const withCredit = await Promise.all(customers.map(async (c) => {
      const creditSales = await prisma.sale.aggregate({
        where: { customerId: c.id, status: 'CONFIRMED', creditAmountPaise: { gt: 0 } },
        _sum: { creditAmountPaise: true },
      });
      const payments = await prisma.creditPayment.aggregate({
        where: { customerId: c.id },
        _sum: { amountPaise: true },
      });
      const outstanding = (creditSales._sum.creditAmountPaise || 0) - (payments._sum.amountPaise || 0);
      return { ...c, outstandingCreditPaise: outstanding };
    }));

    return reply.send({ data: withCredit });
  });

  // GET /api/customers/:id
  app.get('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as any;

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        sales: {
          where: { status: 'CONFIRMED' },
          orderBy: { confirmedAt: 'desc' },
          take: 20,
          select: {
            id: true, invoiceNumber: true, totalAmountPaise: true,
            creditAmountPaise: true, confirmedAt: true, shopId: true,
          },
        },
        creditPayments: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!customer) return reply.code(404).send({ error: 'Customer not found' });

    const creditSales = await prisma.sale.aggregate({
      where: { customerId: id, status: 'CONFIRMED', creditAmountPaise: { gt: 0 } },
      _sum: { creditAmountPaise: true },
    });
    const creditPaid = await prisma.creditPayment.aggregate({
      where: { customerId: id },
      _sum: { amountPaise: true },
    });

    const outstanding = (creditSales._sum.creditAmountPaise || 0) - (creditPaid._sum.amountPaise || 0);

    return reply.send({
      customer: {
        ...customer,
        outstandingCreditPaise: outstanding,
        availableCreditPaise: customer.creditLimitPaise - outstanding,
      },
    });
  });

  // POST /api/customers
  app.post('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const schema = z.object({
      name: z.string().min(2),
      phone: z.string().min(10).max(15),
      address: z.string().optional(),
      creditLimitPaise: z.number().int().min(0).default(0),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Validation error', details: body.error.flatten() });

    const existing = await prisma.customer.findUnique({ where: { phone: body.data.phone } });
    if (existing) return reply.code(409).send({ error: 'Customer with this phone already exists' });

    const customer = await prisma.customer.create({ data: body.data });
    return reply.code(201).send({ customer });
  });

  // PUT /api/customers/:id
  app.put('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    const schema = z.object({
      name: z.string().min(2).optional(),
      phone: z.string().min(10).optional(),
      address: z.string().optional(),
      creditLimitPaise: z.number().int().min(0).optional(),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Validation error' });

    const customer = await prisma.customer.update({ where: { id }, data: body.data });
    return reply.send({ customer });
  });

  // POST /api/customers/:id/credit-payments
  app.post('/:id/credit-payments', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as any;
    const schema = z.object({
      amountPaise: z.number().int().positive(),
      mode: z.enum(['CASH', 'UPI', 'BANK_TRANSFER']),
      reference: z.string().optional(),
    });
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Validation error' });

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return reply.code(404).send({ error: 'Customer not found' });

    // Verify payment doesn't exceed outstanding
    const creditSales = await prisma.sale.aggregate({
      where: { customerId: id, status: 'CONFIRMED', creditAmountPaise: { gt: 0 } },
      _sum: { creditAmountPaise: true },
    });
    const prevPayments = await prisma.creditPayment.aggregate({
      where: { customerId: id },
      _sum: { amountPaise: true },
    });
    const outstanding = (creditSales._sum.creditAmountPaise || 0) - (prevPayments._sum.amountPaise || 0);

    if (body.data.amountPaise > outstanding) {
      return reply.code(422).send({
        error: `Payment (₹${(body.data.amountPaise / 100).toFixed(2)}) exceeds outstanding credit (₹${(outstanding / 100).toFixed(2)})`,
      });
    }

    const payment = await prisma.creditPayment.create({
      data: { customerId: id, ...body.data },
    });

    return reply.code(201).send({ payment, outstandingAfterPaise: outstanding - body.data.amountPaise });
  });
}
