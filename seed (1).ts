// prisma/seed.ts
import { PrismaClient, Role, PaymentMode } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Categories ──────────────────────────────────────────────
  const categories = await Promise.all([
    prisma.category.upsert({ where: { name: 'Pipes & Fittings' }, update: {}, create: { name: 'Pipes & Fittings' } }),
    prisma.category.upsert({ where: { name: 'Electrical' }, update: {}, create: { name: 'Electrical' } }),
    prisma.category.upsert({ where: { name: 'Cement & Construction' }, update: {}, create: { name: 'Cement & Construction' } }),
    prisma.category.upsert({ where: { name: 'Hardware & Fasteners' }, update: {}, create: { name: 'Hardware & Fasteners' } }),
    prisma.category.upsert({ where: { name: 'Tools' }, update: {}, create: { name: 'Tools' } }),
    prisma.category.upsert({ where: { name: 'Paints & Waterproofing' }, update: {}, create: { name: 'Paints & Waterproofing' } }),
  ]);

  const [pipes, electrical, cement, hardware, tools, paints] = categories;

  // ─── Products ────────────────────────────────────────────────
  const products = await Promise.all([
    // Pipes
    prisma.product.upsert({ where: { sku: 'PIPE-UPVC-110-1M' }, update: {}, create: { name: 'UPVC Pipe 110mm 1M', sku: 'PIPE-UPVC-110-1M', unit: 'pc', categoryId: pipes.id, description: 'UPVC pressure pipe 110mm diameter, 1 metre' } }),
    prisma.product.upsert({ where: { sku: 'PIPE-GI-25-3M' }, update: {}, create: { name: 'GI Pipe 25mm 3M', sku: 'PIPE-GI-25-3M', unit: 'pc', categoryId: pipes.id, description: 'Galvanized iron pipe 25mm, 3 metre' } }),
    prisma.product.upsert({ where: { sku: 'FIT-ELBOW-110' }, update: {}, create: { name: 'UPVC Elbow 110mm', sku: 'FIT-ELBOW-110', unit: 'pc', categoryId: pipes.id, description: '90 degree elbow 110mm UPVC' } }),
    prisma.product.upsert({ where: { sku: 'FIT-COUPLER-110' }, update: {}, create: { name: 'UPVC Coupler 110mm', sku: 'FIT-COUPLER-110', unit: 'pc', categoryId: pipes.id, description: 'Plain coupler 110mm UPVC' } }),
    // Electrical
    prisma.product.upsert({ where: { sku: 'WIRE-4SQMM-100M' }, update: {}, create: { name: 'Copper Wire 4 Sq.mm 100M', sku: 'WIRE-4SQMM-100M', unit: 'coil', categoryId: electrical.id, description: 'FR PVC insulated copper wire 4 sq.mm' } }),
    prisma.product.upsert({ where: { sku: 'WIRE-2SQMM-100M' }, update: {}, create: { name: 'Copper Wire 2.5 Sq.mm 100M', sku: 'WIRE-2SQMM-100M', unit: 'coil', categoryId: electrical.id, description: 'FR PVC insulated copper wire 2.5 sq.mm' } }),
    prisma.product.upsert({ where: { sku: 'MCB-32A-SP' }, update: {}, create: { name: 'MCB 32A Single Pole', sku: 'MCB-32A-SP', unit: 'pc', categoryId: electrical.id } }),
    prisma.product.upsert({ where: { sku: 'CONDUIT-25-3M' }, update: {}, create: { name: 'PVC Conduit 25mm 3M', sku: 'CONDUIT-25-3M', unit: 'pc', categoryId: electrical.id } }),
    // Cement
    prisma.product.upsert({ where: { sku: 'CEM-OPC53-50KG' }, update: {}, create: { name: 'OPC 53 Grade Cement 50kg', sku: 'CEM-OPC53-50KG', unit: 'bag', categoryId: cement.id, description: 'Ordinary Portland Cement 53 grade' } }),
    prisma.product.upsert({ where: { sku: 'SAND-MSAND-50KG' }, update: {}, create: { name: 'M-Sand 50kg', sku: 'SAND-MSAND-50KG', unit: 'bag', categoryId: cement.id } }),
    prisma.product.upsert({ where: { sku: 'BLOCK-6IN-SOLID' }, update: {}, create: { name: 'Solid Block 6 inch', sku: 'BLOCK-6IN-SOLID', unit: 'pc', categoryId: cement.id } }),
    // Hardware
    prisma.product.upsert({ where: { sku: 'BOLT-M12-100' }, update: {}, create: { name: 'M12 Hex Bolt 100mm', sku: 'BOLT-M12-100', unit: 'pc', categoryId: hardware.id } }),
    prisma.product.upsert({ where: { sku: 'SCREW-SS-M8-50' }, update: {}, create: { name: 'SS Self Drilling Screw M8', sku: 'SCREW-SS-M8-50', unit: 'box', categoryId: hardware.id, description: 'Box of 50 pieces' } }),
    prisma.product.upsert({ where: { sku: 'ANCHOR-M10-25' }, update: {}, create: { name: 'Anchor Bolt M10 (25pcs)', sku: 'ANCHOR-M10-25', unit: 'box', categoryId: hardware.id } }),
    // Tools
    prisma.product.upsert({ where: { sku: 'DRILL-13MM-BOSCH' }, update: {}, create: { name: 'Bosch 13mm Drill Machine', sku: 'DRILL-13MM-BOSCH', unit: 'pc', categoryId: tools.id } }),
    prisma.product.upsert({ where: { sku: 'TAPE-5M-STEEL' }, update: {}, create: { name: 'Steel Tape 5M', sku: 'TAPE-5M-STEEL', unit: 'pc', categoryId: tools.id } }),
    // Paints
    prisma.product.upsert({ where: { sku: 'PAINT-EXT-20L-WHITE' }, update: {}, create: { name: 'Exterior Emulsion 20L White', sku: 'PAINT-EXT-20L-WHITE', unit: 'tin', categoryId: paints.id } }),
    prisma.product.upsert({ where: { sku: 'PRIMER-WALL-20L' }, update: {}, create: { name: 'Wall Primer 20L', sku: 'PRIMER-WALL-20L', unit: 'tin', categoryId: paints.id } }),
  ]);

  // ─── Shops ───────────────────────────────────────────────────
  const mainShop = await prisma.shop.upsert({
    where: { id: 'shop-main-001' },
    update: {},
    create: {
      id: 'shop-main-001',
      name: 'Indus Hardware — Main Branch',
      address: '12, Industrial Area, Phase 2, Ludhiana, Punjab 141003',
      phone: '+91 98765 43210',
    },
  });

  const shop2 = await prisma.shop.upsert({
    where: { id: 'shop-branch-002' },
    update: {},
    create: {
      id: 'shop-branch-002',
      name: 'Indus Hardware — Branch 2',
      address: '45, Civil Lines, Ludhiana, Punjab 141001',
      phone: '+91 98765 43211',
    },
  });

  // ─── Stock Ledgers ───────────────────────────────────────────
  const stockData = [
    { productIdx: 0,  costPaise: 18000,  salePaise: 24000,  qty: 200 },
    { productIdx: 1,  costPaise: 95000,  salePaise: 120000, qty: 50  },
    { productIdx: 2,  costPaise: 3500,   salePaise: 5000,   qty: 500 },
    { productIdx: 3,  costPaise: 2500,   salePaise: 3500,   qty: 400 },
    { productIdx: 4,  costPaise: 320000, salePaise: 400000, qty: 30  },
    { productIdx: 5,  costPaise: 220000, salePaise: 280000, qty: 40  },
    { productIdx: 6,  costPaise: 35000,  salePaise: 45000,  qty: 60  },
    { productIdx: 7,  costPaise: 8000,   salePaise: 12000,  qty: 100 },
    { productIdx: 8,  costPaise: 38000,  salePaise: 45000,  qty: 200 },
    { productIdx: 9,  costPaise: 22000,  salePaise: 28000,  qty: 100 },
    { productIdx: 10, costPaise: 1500,   salePaise: 2200,   qty: 2000},
    { productIdx: 11, costPaise: 1800,   salePaise: 2500,   qty: 500 },
    { productIdx: 12, costPaise: 2800,   salePaise: 3800,   qty: 1000},
    { productIdx: 13, costPaise: 4500,   salePaise: 6000,   qty: 200 },
    { productIdx: 14, costPaise: 780000, salePaise: 950000, qty: 10  },
    { productIdx: 15, costPaise: 18000,  salePaise: 24000,  qty: 50  },
    { productIdx: 16, costPaise: 680000, salePaise: 850000, qty: 20  },
    { productIdx: 17, costPaise: 450000, salePaise: 560000, qty: 25  },
  ];

  for (const s of stockData) {
    await prisma.stockLedger.upsert({
      where: { shopId_productId: { shopId: mainShop.id, productId: products[s.productIdx].id } },
      update: {},
      create: {
        shopId: mainShop.id,
        productId: products[s.productIdx].id,
        quantityOnHand: s.qty,
        costPricePaise: s.costPaise,
        salePricePaise: s.salePaise,
        reorderLevel: Math.floor(s.qty * 0.1),
      },
    });
    // Also seed branch 2 with half stock
    await prisma.stockLedger.upsert({
      where: { shopId_productId: { shopId: shop2.id, productId: products[s.productIdx].id } },
      update: {},
      create: {
        shopId: shop2.id,
        productId: products[s.productIdx].id,
        quantityOnHand: Math.floor(s.qty / 2),
        costPricePaise: s.costPaise,
        salePricePaise: s.salePaise,
        reorderLevel: Math.floor(s.qty * 0.05),
      },
    });
  }

  // ─── Admin User ──────────────────────────────────────────────
  const adminPassword = await bcrypt.hash('Admin@Indus2025', 10);
  await prisma.user.upsert({
    where: { email: 'admin@indusmaterials.com' },
    update: {},
    create: {
      name: 'Indus Admin',
      email: 'admin@indusmaterials.com',
      passwordHash: adminPassword,
      role: Role.ADMIN,
    },
  });

  // Shop manager for main branch
  const mgr1Pass = await bcrypt.hash('Shop@Main2025', 10);
  await prisma.user.upsert({
    where: { email: 'main@indusmaterials.com' },
    update: {},
    create: {
      name: 'Main Branch Manager',
      email: 'main@indusmaterials.com',
      passwordHash: mgr1Pass,
      role: Role.SHOP_MANAGER,
      shopId: mainShop.id,
    },
  });

  // Shop manager for branch 2
  const mgr2Pass = await bcrypt.hash('Shop@Branch2025', 10);
  await prisma.user.upsert({
    where: { email: 'branch2@indusmaterials.com' },
    update: {},
    create: {
      name: 'Branch 2 Manager',
      email: 'branch2@indusmaterials.com',
      passwordHash: mgr2Pass,
      role: Role.SHOP_MANAGER,
      shopId: shop2.id,
    },
  });

  // ─── Sample Customers ────────────────────────────────────────
  await Promise.all([
    prisma.customer.upsert({ where: { phone: '9876500001' }, update: {}, create: { name: 'Rajan Constructions', phone: '9876500001', address: 'Sector 12, Ludhiana', creditLimitPaise: 5000000 } }),
    prisma.customer.upsert({ where: { phone: '9876500002' }, update: {}, create: { name: 'Sharma Builders', phone: '9876500002', address: 'Model Town, Ludhiana', creditLimitPaise: 2500000 } }),
    prisma.customer.upsert({ where: { phone: '9876500003' }, update: {}, create: { name: 'Patel Electricals', phone: '9876500003', address: 'Focal Point, Ludhiana', creditLimitPaise: 1000000 } }),
  ]);

  console.log('✅ Seed complete!');
  console.log('');
  console.log('Admin credentials:');
  console.log('  Email: admin@indusmaterials.com');
  console.log('  Password: Admin@Indus2025');
  console.log('');
  console.log('Shop Manager (Main):');
  console.log('  Email: main@indusmaterials.com');
  console.log('  Password: Shop@Main2025');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
