// packages/db/seed.ts
import { PrismaClient, Role, StockMovementType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Indus Hardware database...');

  // ── Categories ────────────────────────────────────────────
  const categories = await Promise.all([
    prisma.category.upsert({ where: { name: 'Pipes & Fittings' }, update: {}, create: { name: 'Pipes & Fittings' } }),
    prisma.category.upsert({ where: { name: 'Electrical' }, update: {}, create: { name: 'Electrical' } }),
    prisma.category.upsert({ where: { name: 'Hand Tools' }, update: {}, create: { name: 'Hand Tools' } }),
    prisma.category.upsert({ where: { name: 'Paints & Adhesives' }, update: {}, create: { name: 'Paints & Adhesives' } }),
    prisma.category.upsert({ where: { name: 'Safety Equipment' }, update: {}, create: { name: 'Safety Equipment' } }),
    prisma.category.upsert({ where: { name: 'Fasteners' }, update: {}, create: { name: 'Fasteners' } }),
  ]);
  console.log('✅ Categories created');

  // ── Products ──────────────────────────────────────────────
  const productData = [
    { name: 'GI Pipe 1/2"', sku: 'GIP-001', unit: 'meter', categoryId: categories[0].id, pricePaise: 8500, costPaise: 6800 },
    { name: 'GI Pipe 3/4"', sku: 'GIP-002', unit: 'meter', categoryId: categories[0].id, pricePaise: 11000, costPaise: 8800 },
    { name: 'CPVC Pipe 1"', sku: 'CPV-001', unit: 'meter', categoryId: categories[0].id, pricePaise: 14500, costPaise: 11600 },
    { name: 'Elbow 90° 1/2"', sku: 'ELB-001', unit: 'pcs', categoryId: categories[0].id, pricePaise: 1200, costPaise: 900 },
    { name: 'Ball Valve 1/2"', sku: 'BLV-001', unit: 'pcs', categoryId: categories[0].id, pricePaise: 9500, costPaise: 7000 },
    { name: 'Tee 1/2"', sku: 'TEE-001', unit: 'pcs', categoryId: categories[0].id, pricePaise: 1500, costPaise: 1100 },
    { name: 'Wire 1.5mm (100m)', sku: 'WIR-001', unit: 'roll', categoryId: categories[1].id, pricePaise: 85000, costPaise: 68000 },
    { name: 'Wire 2.5mm (100m)', sku: 'WIR-002', unit: 'roll', categoryId: categories[1].id, pricePaise: 125000, costPaise: 100000 },
    { name: 'MCB 32A', sku: 'MCB-001', unit: 'pcs', categoryId: categories[1].id, pricePaise: 28000, costPaise: 22000 },
    { name: 'Switch Board 6A', sku: 'SWB-001', unit: 'pcs', categoryId: categories[1].id, pricePaise: 4500, costPaise: 3500 },
    { name: 'Conduit Pipe 25mm', sku: 'CDP-001', unit: 'meter', categoryId: categories[1].id, pricePaise: 3500, costPaise: 2800 },
    { name: 'Hammer 500g', sku: 'HAM-001', unit: 'pcs', categoryId: categories[2].id, pricePaise: 18000, costPaise: 14000 },
    { name: 'Spanner Set 12pc', sku: 'SPN-001', unit: 'set', categoryId: categories[2].id, pricePaise: 45000, costPaise: 36000 },
    { name: 'Screwdriver Set 6pc', sku: 'SCR-001', unit: 'set', categoryId: categories[2].id, pricePaise: 22000, costPaise: 17000 },
    { name: 'Tape Measure 5m', sku: 'TAP-001', unit: 'pcs', categoryId: categories[2].id, pricePaise: 8500, costPaise: 6500 },
    { name: 'Asian Paints 1L', sku: 'PNT-001', unit: 'ltr', categoryId: categories[3].id, pricePaise: 32000, costPaise: 25000 },
    { name: 'Fevicol SH 1kg', sku: 'ADH-001', unit: 'kg', categoryId: categories[3].id, pricePaise: 18500, costPaise: 14800 },
    { name: 'Primer Grey 1L', sku: 'PNT-002', unit: 'ltr', categoryId: categories[3].id, pricePaise: 25000, costPaise: 19000 },
    { name: 'Safety Helmet', sku: 'SAF-001', unit: 'pcs', categoryId: categories[4].id, pricePaise: 28000, costPaise: 20000 },
    { name: 'Safety Gloves (pair)', sku: 'SAF-002', unit: 'pair', categoryId: categories[4].id, pricePaise: 8500, costPaise: 6000 },
    { name: 'Screw M6x50 (100pc)', sku: 'FST-001', unit: 'box', categoryId: categories[5].id, pricePaise: 9500, costPaise: 7200 },
    { name: 'Nut M6 (100pc)', sku: 'FST-002', unit: 'box', categoryId: categories[5].id, pricePaise: 6500, costPaise: 5000 },
    { name: 'Anchor Bolt 10mm', sku: 'FST-003', unit: 'pcs', categoryId: categories[5].id, pricePaise: 850, costPaise: 650 },
  ];

  const products = [];
  for (const p of productData) {
    const prod = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: p,
    });
    products.push(prod);
  }
  console.log(`✅ ${products.length} products created`);

  // ── Shops ─────────────────────────────────────────────────
  const shop1 = await prisma.shop.upsert({
    where: { id: 'shop-main' },
    update: {},
    create: {
      id: 'shop-main',
      name: 'Indus Hardware - Main Branch',
      address: '12 Industrial Area, Phase II, Ludhiana, Punjab 141003',
      phone: '+91-161-4567890',
    },
  });
  const shop2 = await prisma.shop.upsert({
    where: { id: 'shop-east' },
    update: {},
    create: {
      id: 'shop-east',
      name: 'Indus Hardware - East Branch',
      address: '45 Civil Lines, Near Bus Stand, Ludhiana, Punjab 141001',
      phone: '+91-161-4567891',
    },
  });
  console.log('✅ Shops created');

  // ── Users ─────────────────────────────────────────────────
  const adminHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@Indus123', 12);
  const managerHash = await bcrypt.hash(process.env.MANAGER_PASSWORD || 'Manager@123', 12);

  await prisma.user.upsert({
    where: { email: 'admin@indushardware.com' },
    update: {},
    create: {
      name: 'System Admin',
      email: 'admin@indushardware.com',
      passwordHash: adminHash,
      role: Role.ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { email: 'manager.main@indushardware.com' },
    update: {},
    create: {
      name: 'Rajesh Kumar',
      email: 'manager.main@indushardware.com',
      passwordHash: managerHash,
      role: Role.SHOP_MANAGER,
      shopId: shop1.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'manager.east@indushardware.com' },
    update: {},
    create: {
      name: 'Priya Sharma',
      email: 'manager.east@indushardware.com',
      passwordHash: managerHash,
      role: Role.SHOP_MANAGER,
      shopId: shop2.id,
    },
  });
  console.log('✅ Users created (admin + 2 managers)');

  // ── Stock (opening stock for both shops) ──────────────────
  const stockData = [
    { qty: 150, reorder: 20 },  // GI Pipe 1/2"
    { qty: 120, reorder: 20 },  // GI Pipe 3/4"
    { qty: 80, reorder: 15 },   // CPVC
    { qty: 500, reorder: 100 }, // Elbow
    { qty: 60, reorder: 10 },   // Ball valve
    { qty: 400, reorder: 80 },  // Tee
    { qty: 30, reorder: 5 },    // Wire 1.5mm
    { qty: 20, reorder: 5 },    // Wire 2.5mm
    { qty: 50, reorder: 10 },   // MCB
    { qty: 100, reorder: 20 },  // Switch board
    { qty: 200, reorder: 30 },  // Conduit
    { qty: 40, reorder: 8 },    // Hammer
    { qty: 25, reorder: 5 },    // Spanner
    { qty: 35, reorder: 8 },    // Screwdriver
    { qty: 60, reorder: 10 },   // Tape measure
    { qty: 80, reorder: 15 },   // Paint
    { qty: 70, reorder: 15 },   // Fevicol
    { qty: 60, reorder: 12 },   // Primer
    { qty: 45, reorder: 8 },    // Safety helmet
    { qty: 100, reorder: 20 },  // Safety gloves
    { qty: 200, reorder: 40 },  // Screws
    { qty: 300, reorder: 60 },  // Nuts
    { qty: 500, reorder: 100 }, // Anchor bolts
  ];

  for (const shop of [shop1, shop2]) {
    for (let i = 0; i < products.length; i++) {
      const sd = stockData[i] || { qty: 50, reorder: 10 };
      const qty = shop.id === 'shop-east' ? Math.floor(sd.qty * 0.6) : sd.qty;

      const ledger = await prisma.stockLedger.upsert({
        where: { shopId_productId: { shopId: shop.id, productId: products[i].id } },
        update: {},
        create: {
          shopId: shop.id,
          productId: products[i].id,
          quantityOnHand: qty,
          reorderLevel: sd.reorder,
        },
      });

      // Create opening movement only if new
      const existingMovements = await prisma.stockMovement.count({ where: { stockLedgerId: ledger.id } });
      if (existingMovements === 0) {
        await prisma.stockMovement.create({
          data: {
            stockLedgerId: ledger.id,
            type: StockMovementType.OPENING,
            quantityDelta: qty,
            note: 'Opening stock',
          },
        });
      }
    }
  }
  console.log('✅ Stock seeded for both shops');

  // ── Customers ─────────────────────────────────────────────
  const customerData = [
    { name: 'Gurpreet Constructions', phone: '9876543210', address: 'GT Road, Ludhiana', creditLimitPaise: 500000_00, shopId: shop1.id },
    { name: 'Modern Builders', phone: '9876543211', address: 'Civil Lines, Ludhiana', creditLimitPaise: 300000_00, shopId: shop1.id },
    { name: 'Sharma Electricals', phone: '9876543212', address: 'Model Town, Ludhiana', creditLimitPaise: 200000_00, shopId: shop1.id },
    { name: 'Punjab Plumbers', phone: '9876543213', address: 'Focal Point, Ludhiana', creditLimitPaise: 150000_00, shopId: shop2.id },
    { name: 'Singh Hardware Contractors', phone: '9876543214', address: 'Dugri, Ludhiana', creditLimitPaise: 250000_00, shopId: shop2.id },
  ];

  for (const c of customerData) {
    await prisma.customer.upsert({
      where: { id: `cust-${c.phone}` },
      update: {},
      create: { id: `cust-${c.phone}`, ...c },
    });
  }
  console.log('✅ Customers seeded');

  console.log('\n🎉 Database seeded successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Admin login:   admin@indushardware.com');
  console.log('Password:      Admin@Indus123 (change immediately!)');
  console.log('Manager login: manager.main@indushardware.com');
  console.log('Manager pass:  Manager@123 (change immediately!)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
