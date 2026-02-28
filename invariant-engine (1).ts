/**
 * autonomous/invariant-engine.ts
 * Continuous invariant validation, drift scoring, and auto-correction.
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { incidentManager } from './incident-manager';
import { alertWebhook } from '../monitoring/alerts';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
export interface InvariantResult {
  name:          string;
  passed:        boolean;
  driftScore:    number;
  violations:    ViolationRecord[];
  autoCorrected: boolean;
}

export interface ViolationRecord {
  entityId:   string;
  entityType: string;
  shopId?:    string;
  detail:     Record<string, unknown>;
}

type Invariant = {
  name:        string;
  priority:    'P1' | 'P2' | 'P3' | 'P4';
  check:       (prisma: PrismaClient) => Promise<ViolationRecord[]>;
  autoCorrect?: (prisma: PrismaClient, violations: ViolationRecord[]) => Promise<void>;
  // can this invariant's violations be auto-corrected safely?
  safeToAutoCorrect: boolean;
};

// ─────────────────────────────────────────────────────────────
// INVARIANT REGISTRY
// ─────────────────────────────────────────────────────────────
const INVARIANTS: Invariant[] = [
  // ① No negative stock
  {
    name:     'NO_NEGATIVE_STOCK',
    priority: 'P1',
    safeToAutoCorrect: false, // stock=0 floor is safe but we escalate
    check: async (prisma) => {
      const rows = await prisma.$queryRaw<{ id: string; shopId: string; productId: string; qty: number }[]>`
        SELECT id, "shopId", "productId", "quantityOnHand" AS qty
        FROM "StockLedger"
        WHERE "quantityOnHand" < 0
      `;
      return rows.map(r => ({
        entityId:   r.id,
        entityType: 'StockLedger',
        shopId:     r.shopId,
        detail:     { productId: r.productId, quantityOnHand: r.qty },
      }));
    },
  },

  // ② Sale total == sum(line items)
  {
    name:     'SALE_TOTAL_MATCHES_LINE_ITEMS',
    priority: 'P1',
    safeToAutoCorrect: false,
    check: async (prisma) => {
      const rows = await prisma.$queryRaw<{
        id: string; shopId: string; invoiceNumber: string;
        totalAmountPaise: number; lineSum: number; delta: number;
      }[]>`
        SELECT s.id, s."shopId", s."invoiceNumber",
               s."totalAmountPaise",
               COALESCE(SUM(si."lineTotalPaise"), 0)                                  AS "lineSum",
               s."totalAmountPaise" - COALESCE(SUM(si."lineTotalPaise"), 0)           AS delta
        FROM "Sale" s
        LEFT JOIN "SaleItem" si ON si."saleId" = s.id
        WHERE s.status = 'CONFIRMED'
        GROUP BY s.id, s."shopId", s."invoiceNumber", s."totalAmountPaise"
        HAVING ABS(s."totalAmountPaise" - COALESCE(SUM(si."lineTotalPaise"), 0)) > 1
      `;
      return rows.map(r => ({
        entityId:   r.id,
        entityType: 'Sale',
        shopId:     r.shopId,
        detail:     { invoiceNumber: r.invoiceNumber, totalAmountPaise: r.totalAmountPaise, lineSum: r.lineSum, delta: r.delta },
      }));
    },
  },

  // ③ Payment sum == sale total (for confirmed sales)
  {
    name:     'PAYMENT_SUM_MATCHES_SALE_TOTAL',
    priority: 'P1',
    safeToAutoCorrect: false,
    check: async (prisma) => {
      const rows = await prisma.$queryRaw<{
        id: string; shopId: string; invoiceNumber: string;
        totalAmountPaise: number; paymentSum: number; delta: number;
      }[]>`
        SELECT s.id, s."shopId", s."invoiceNumber",
               s."totalAmountPaise",
               (s."paidAmountPaise" + s."creditAmountPaise")                           AS "paymentSum",
               s."totalAmountPaise" - (s."paidAmountPaise" + s."creditAmountPaise")    AS delta
        FROM "Sale" s
        WHERE s.status = 'CONFIRMED'
          AND ABS(s."totalAmountPaise" - (s."paidAmountPaise" + s."creditAmountPaise")) > 1
      `;
      return rows.map(r => ({
        entityId:   r.id,
        entityType: 'Sale',
        shopId:     r.shopId,
        detail:     { invoiceNumber: r.invoiceNumber, totalAmountPaise: r.totalAmountPaise, paymentSum: r.paymentSum, delta: r.delta },
      }));
    },
  },

  // ④ No duplicate invoice numbers
  {
    name:     'NO_DUPLICATE_INVOICES',
    priority: 'P1',
    safeToAutoCorrect: false,
    check: async (prisma) => {
      const rows = await prisma.$queryRaw<{ invoiceNumber: string; count: number; shopId: string }[]>`
        SELECT "invoiceNumber", COUNT(*) AS count, MIN("shopId") AS "shopId"
        FROM "Sale"
        GROUP BY "invoiceNumber"
        HAVING COUNT(*) > 1
      `;
      return rows.map(r => ({
        entityId:   r.invoiceNumber,
        entityType: 'Sale',
        shopId:     r.shopId,
        detail:     { invoiceNumber: r.invoiceNumber, duplicateCount: r.count },
      }));
    },
  },

  // ⑤ Stock movement ledger consistency
  {
    name:     'STOCK_MOVEMENT_BALANCE',
    priority: 'P2',
    safeToAutoCorrect: false,
    check: async (prisma) => {
      const rows = await prisma.$queryRaw<{
        stockLedgerId: string; shopId: string;
        quantityOnHand: number; movementSum: number; delta: number;
      }[]>`
        SELECT sl.id AS "stockLedgerId", sl."shopId",
               sl."quantityOnHand",
               COALESCE(SUM(sm."quantityDelta"), 0)                              AS "movementSum",
               sl."quantityOnHand" - COALESCE(SUM(sm."quantityDelta"), 0)        AS delta
        FROM "StockLedger" sl
        LEFT JOIN "StockMovement" sm ON sm."stockLedgerId" = sl.id
        GROUP BY sl.id, sl."shopId", sl."quantityOnHand"
        HAVING ABS(sl."quantityOnHand" - COALESCE(SUM(sm."quantityDelta"), 0)) > 0
      `;
      return rows.map(r => ({
        entityId:   r.stockLedgerId,
        entityType: 'StockLedger',
        shopId:     r.shopId,
        detail:     { quantityOnHand: r.quantityOnHand, movementSum: r.movementSum, delta: r.delta },
      }));
    },
  },

  // ⑥ Credit limit not exceeded on open credit
  {
    name:     'CREDIT_LIMIT_NOT_EXCEEDED',
    priority: 'P2',
    safeToAutoCorrect: false,
    check: async (prisma) => {
      const rows = await prisma.$queryRaw<{
        customerId: string; name: string;
        creditLimitPaise: number; outstandingPaise: number;
      }[]>`
        SELECT c.id AS "customerId", c.name,
               c."creditLimitPaise",
               COALESCE(SUM(s."creditAmountPaise"), 0) -
               COALESCE((SELECT SUM(cp."amountPaise") FROM "CreditPayment" cp WHERE cp."customerId" = c.id), 0)
                 AS "outstandingPaise"
        FROM "Customer" c
        LEFT JOIN "Sale" s ON s."customerId" = c.id AND s.status = 'CONFIRMED'
        WHERE c."creditLimitPaise" > 0
        GROUP BY c.id, c.name, c."creditLimitPaise"
        HAVING COALESCE(SUM(s."creditAmountPaise"), 0) -
               COALESCE((SELECT SUM(cp."amountPaise") FROM "CreditPayment" cp WHERE cp."customerId" = c.id), 0)
               > c."creditLimitPaise" * 1.05
      `;
      return rows.map(r => ({
        entityId:   r.customerId,
        entityType: 'Customer',
        detail:     { name: r.name, creditLimitPaise: r.creditLimitPaise, outstandingPaise: r.outstandingPaise },
      }));
    },
  },

  // ⑦ No orphaned sale items
  {
    name:     'NO_ORPHANED_SALE_ITEMS',
    priority: 'P3',
    safeToAutoCorrect: true,
    check: async (prisma) => {
      const rows = await prisma.$queryRaw<{ id: string; saleId: string }[]>`
        SELECT si.id, si."saleId"
        FROM "SaleItem" si
        LEFT JOIN "Sale" s ON s.id = si."saleId"
        WHERE s.id IS NULL
      `;
      return rows.map(r => ({
        entityId:   r.id,
        entityType: 'SaleItem',
        detail:     { saleId: r.saleId },
      }));
    },
    autoCorrect: async (prisma, violations) => {
      const ids = violations.map(v => v.entityId);
      if (ids.length === 0) return;
      await prisma.$executeRawUnsafe(
        `DELETE FROM "SaleItem" WHERE id = ANY($1::TEXT[])`, ids
      );
      logger.warn('[INVARIANT:AUTO_CORRECT] Deleted orphaned SaleItems', { count: ids.length });
    },
  },
];

// ─────────────────────────────────────────────────────────────
// DRIFT SCORER
// ─────────────────────────────────────────────────────────────
export function computeDriftScore(results: InvariantResult[]): number {
  const weights: Record<string, number> = {
    NO_NEGATIVE_STOCK:              25,
    SALE_TOTAL_MATCHES_LINE_ITEMS:  20,
    PAYMENT_SUM_MATCHES_SALE_TOTAL: 20,
    NO_DUPLICATE_INVOICES:          15,
    STOCK_MOVEMENT_BALANCE:         10,
    CREDIT_LIMIT_NOT_EXCEEDED:       7,
    NO_ORPHANED_SALE_ITEMS:          3,
  };

  let deduction = 0;
  for (const r of results) {
    if (!r.passed) {
      const weight = weights[r.name] ?? 5;
      // Cap deduction per invariant at its weight
      deduction += Math.min(weight, weight * Math.log10(r.violations.length + 1));
    }
  }
  return Math.max(0, Math.round(100 - deduction));
}

// ─────────────────────────────────────────────────────────────
// INVARIANT EXECUTOR
// ─────────────────────────────────────────────────────────────
export class InvariantEngine {
  constructor(private readonly prisma: PrismaClient) {}

  async runAll(): Promise<{ results: InvariantResult[]; driftScore: number }> {
    logger.info('[INVARIANT] Running all invariants...');
    const results: InvariantResult[] = [];

    for (const inv of INVARIANTS) {
      try {
        const violations = await inv.check(this.prisma);
        let autoCorrected = false;

        if (violations.length > 0 && inv.safeToAutoCorrect && inv.autoCorrect) {
          try {
            await inv.autoCorrect(this.prisma, violations);
            autoCorrected = true;
          } catch (err) {
            logger.error(`[INVARIANT] Auto-correct failed for ${inv.name}`, { err });
          }
        }

        const result: InvariantResult = {
          name:          inv.name,
          passed:        violations.length === 0 || autoCorrected,
          driftScore:    violations.length === 0 ? 100 : Math.max(0, 100 - violations.length * 10),
          violations,
          autoCorrected,
        };

        results.push(result);

        // Persist violation records
        if (violations.length > 0) {
          await this.persistViolations(inv.name, violations, autoCorrected, inv.priority);
        }

        logger.info(`[INVARIANT] ${result.passed ? '✅' : '❌'} ${inv.name}: ${violations.length} violations${autoCorrected ? ' (auto-corrected)' : ''}`);
      } catch (err) {
        logger.error(`[INVARIANT] Check failed: ${inv.name}`, { err });
        results.push({ name: inv.name, passed: false, driftScore: 0, violations: [], autoCorrected: false });
      }
    }

    const driftScore = computeDriftScore(results);

    // Persist drift score
    await this.prisma.$executeRaw`
      INSERT INTO drift_scores (score, components)
      VALUES (${driftScore}, ${JSON.stringify(
        results.reduce((acc, r) => ({ ...acc, [r.name]: { passed: r.passed, count: r.violations.length } }), {})
      )}::JSONB)
    `;

    // Handle failed invariants
    const failed = results.filter(r => !r.passed);
    for (const r of failed) {
      const inv = INVARIANTS.find(i => i.name === r.name)!;
      await incidentManager.createOrUpdateFromInvariant(r, inv.priority);
    }

    logger.info(`[INVARIANT] Complete. DriftScore=${driftScore}. Failures=${failed.length}`);
    return { results, driftScore };
  }

  private async persistViolations(
    invariant: string,
    violations: ViolationRecord[],
    autoCorrected: boolean,
    _priority: string,
  ): Promise<void> {
    for (const v of violations.slice(0, 100)) { // cap at 100 records
      await this.prisma.$executeRaw`
        INSERT INTO invariant_violations
          (invariant, shop_id, entity_id, entity_type, details, auto_corrected, drift_score)
        VALUES
          (${invariant}, ${v.shopId ?? null}, ${v.entityId}, ${v.entityType},
           ${JSON.stringify(v.detail)}::JSONB, ${autoCorrected}, 0)
      `;
    }
  }

  async getDriftScore(): Promise<number> {
    const row = await this.prisma.$queryRaw<{ score: number }[]>`
      SELECT score FROM drift_scores ORDER BY created_at DESC LIMIT 1
    `;
    return row[0]?.score ?? 100;
  }
}
