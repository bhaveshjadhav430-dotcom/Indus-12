// apps/api/src/routes/reports.ts
import { FastifyInstance } from 'fastify';
import { prisma } from '../server.js';

export async function reportRoutes(app: FastifyInstance) {

  // GET /api/reports/dashboard?shopId=&from=&to=
  app.get('/dashboard', { preHandler: [app.authenticate] }, async (request, reply) => {
    const q = request.query as any;
    const user = request.user as any;
    const shopId = user.role === 'ADMIN' ? q.shopId : user.shopId;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = q.from ? new Date(q.from) : today;
    const to = q.to ? new Date(q.to) : new Date(today.getTime() + 86400000 - 1);

    const where: any = { status: 'CONFIRMED', confirmedAt: { gte: from, lte: to } };
    if (shopId) where.shopId = shopId;

    const [salesAgg, salesCount, lowStock, openCredit, recentSales] = await Promise.all([
      prisma.sale.aggregate({ where, _sum: { totalAmountPaise: true, paidAmountPaise: true, creditAmountPaise: true } }),
      prisma.sale.count({ where }),
      prisma.stockLedger.count({
        where: {
          ...(shopId && { shopId }),
          quantityOnHand: { lte: 10 },
        },
      }),
      prisma.sale.aggregate({
        where: { ...(shopId && { shopId }), status: 'CONFIRMED', creditAmountPaise: { gt: 0 } },
        _sum: { creditAmountPaise: true },
      }),
      prisma.sale.findMany({
        where: { ...(shopId && { shopId }), status: 'CONFIRMED' },
        orderBy: { confirmedAt: 'desc' },
        take: 10,
        select: {
          id: true, invoiceNumber: true, totalAmountPaise: true, confirmedAt: true,
          customer: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);

    // Outstanding credit (net of payments)
    const creditPaymentsTotal = await prisma.creditPayment.aggregate({
      _sum: { amountPaise: true },
    });

    return reply.send({
      period: { from, to },
      sales: {
        count: salesCount,
        totalRevenuePaise: salesAgg._sum.totalAmountPaise || 0,
        totalCashPaise: salesAgg._sum.paidAmountPaise || 0,
        totalCreditPaise: salesAgg._sum.creditAmountPaise || 0,
      },
      creditOutstandingPaise: Math.max(0,
        (openCredit._sum.creditAmountPaise || 0) - (creditPaymentsTotal._sum.amountPaise || 0)
      ),
      lowStockItems: lowStock,
      recentSales,
    });
  });

  // GET /api/reports/sales-summary?shopId=&groupBy=day|month
  app.get('/sales-summary', { preHandler: [app.authenticate] }, async (request, reply) => {
    const q = request.query as any;
    const user = request.user as any;
    const shopId = user.role === 'ADMIN' ? q.shopId : user.shopId;
    const days = parseInt(q.days || '30');

    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    const where: any = { status: 'CONFIRMED', confirmedAt: { gte: from } };
    if (shopId) where.shopId = shopId;

    const sales = await prisma.sale.findMany({
      where,
      select: { confirmedAt: true, totalAmountPaise: true, paidAmountPaise: true, creditAmountPaise: true },
      orderBy: { confirmedAt: 'asc' },
    });

    // Group by date
    const grouped: Record<string, { date: string; revenue: number; cash: number; credit: number; count: number }> = {};
    for (const s of sales) {
      const d = s.confirmedAt!.toISOString().slice(0, 10);
      if (!grouped[d]) grouped[d] = { date: d, revenue: 0, cash: 0, credit: 0, count: 0 };
      grouped[d].revenue += s.totalAmountPaise;
      grouped[d].cash += s.paidAmountPaise;
      grouped[d].credit += s.creditAmountPaise;
      grouped[d].count++;
    }

    return reply.send({ data: Object.values(grouped) });
  });

  // GET /api/reports/top-products?shopId=&limit=
  app.get('/top-products', { preHandler: [app.authenticate] }, async (request, reply) => {
    const q = request.query as any;
    const user = request.user as any;
    const shopId = user.role === 'ADMIN' ? q.shopId : user.shopId;
    const limit = Math.min(20, parseInt(q.limit || '10'));
    const days = parseInt(q.days || '30');
    const from = new Date(Date.now() - days * 86400000);

    const where: any = {
      sale: { status: 'CONFIRMED', confirmedAt: { gte: from } },
    };
    if (shopId) where.sale.shopId = shopId;

    const items = await prisma.saleItem.groupBy({
      by: ['productId'],
      where,
      _sum: { quantity: true, lineTotalPaise: true },
      orderBy: { _sum: { lineTotalPaise: 'desc' } },
      take: limit,
    });

    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true, unit: true, category: { select: { name: true } } },
    });

    const result = items.map((item) => ({
      product: products.find((p) => p.id === item.productId),
      quantitySold: item._sum.quantity || 0,
      revenuePaise: item._sum.lineTotalPaise || 0,
    }));

    return reply.send({ data: result });
  });
}
