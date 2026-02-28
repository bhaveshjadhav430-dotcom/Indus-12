-- ════════════════════════════════════════════════════════════════
-- verify-autonomous.sql
-- Run: psql $DATABASE_URL -f verify-autonomous.sql
-- Returns row sets for each check. Any rows from FAIL checks = issue.
-- ════════════════════════════════════════════════════════════════

\echo '══ 1. NO NEGATIVE STOCK ══'
SELECT
  sl.id              AS stock_ledger_id,
  sl."shopId",
  sl."productId",
  p.sku,
  p.name             AS product_name,
  sl."quantityOnHand"
FROM "StockLedger" sl
JOIN "Product" p ON p.id = sl."productId"
WHERE sl."quantityOnHand" < 0;

\echo '══ 2. SALE TOTAL == SUM(LINE ITEMS) ══'
SELECT
  s.id,
  s."invoiceNumber",
  s."shopId",
  s."totalAmountPaise",
  COALESCE(SUM(si."lineTotalPaise"), 0)                               AS line_sum,
  s."totalAmountPaise" - COALESCE(SUM(si."lineTotalPaise"), 0)        AS delta_paise
FROM "Sale" s
LEFT JOIN "SaleItem" si ON si."saleId" = s.id
WHERE s.status = 'CONFIRMED'
GROUP BY s.id, s."invoiceNumber", s."shopId", s."totalAmountPaise"
HAVING ABS(s."totalAmountPaise" - COALESCE(SUM(si."lineTotalPaise"), 0)) > 1
ORDER BY ABS(delta_paise) DESC;

\echo '══ 3. PAYMENT SUM == SALE TOTAL ══'
SELECT
  s.id,
  s."invoiceNumber",
  s."totalAmountPaise",
  (s."paidAmountPaise" + s."creditAmountPaise")                        AS payment_sum,
  s."totalAmountPaise" - (s."paidAmountPaise" + s."creditAmountPaise") AS delta_paise
FROM "Sale" s
WHERE s.status = 'CONFIRMED'
  AND ABS(s."totalAmountPaise" - (s."paidAmountPaise" + s."creditAmountPaise")) > 1
ORDER BY ABS(delta_paise) DESC;

\echo '══ 4. DUPLICATE INVOICE NUMBERS ══'
SELECT
  "invoiceNumber",
  COUNT(*)      AS duplicate_count,
  MIN("shopId") AS shop_id,
  array_agg(id) AS sale_ids
FROM "Sale"
GROUP BY "invoiceNumber"
HAVING COUNT(*) > 1;

\echo '══ 5. STOCK MOVEMENT BALANCE ══'
SELECT
  sl.id       AS stock_ledger_id,
  sl."shopId",
  sl."productId",
  p.sku,
  sl."quantityOnHand"                             AS recorded_qty,
  COALESCE(SUM(sm."quantityDelta"), 0)            AS movement_sum,
  sl."quantityOnHand" - COALESCE(SUM(sm."quantityDelta"), 0) AS delta
FROM "StockLedger" sl
JOIN "Product" p ON p.id = sl."productId"
LEFT JOIN "StockMovement" sm ON sm."stockLedgerId" = sl.id
GROUP BY sl.id, sl."shopId", sl."productId", p.sku, sl."quantityOnHand"
HAVING ABS(sl."quantityOnHand" - COALESCE(SUM(sm."quantityDelta"), 0)) > 0
ORDER BY ABS(delta) DESC;

\echo '══ 6. ORPHANED SALE ITEMS ══'
SELECT si.id, si."saleId", si."productId"
FROM "SaleItem" si
LEFT JOIN "Sale" s ON s.id = si."saleId"
WHERE s.id IS NULL;

\echo '══ 7. ORPHANED PAYMENTS ══'
SELECT p.id, p."saleId", p."amountPaise", p.mode
FROM "SalePayment" p
LEFT JOIN "Sale" s ON s.id = p."saleId"
WHERE s.id IS NULL;

\echo '══ 8. CREDIT LIMIT BREACHES ══'
SELECT
  c.id              AS customer_id,
  c.name,
  c."creditLimitPaise",
  COALESCE(SUM(s."creditAmountPaise"), 0) -
    COALESCE((SELECT SUM(cp."amountPaise") FROM "CreditPayment" cp WHERE cp."customerId" = c.id), 0)
                    AS outstanding_paise
FROM "Customer" c
LEFT JOIN "Sale" s ON s."customerId" = c.id AND s.status = 'CONFIRMED'
WHERE c."creditLimitPaise" > 0
GROUP BY c.id, c.name, c."creditLimitPaise"
HAVING COALESCE(SUM(s."creditAmountPaise"), 0) -
       COALESCE((SELECT SUM(cp."amountPaise") FROM "CreditPayment" cp WHERE cp."customerId" = c.id), 0)
       > c."creditLimitPaise";

\echo '══ 9. AUDIT CHAIN INTEGRITY ══'
SELECT
  a.id,
  a.prev_hash,
  lag(a.row_hash) OVER (ORDER BY a."createdAt") AS expected_prev_hash,
  CASE
    WHEN lag(a.row_hash) OVER (ORDER BY a."createdAt") IS NULL THEN 'GENESIS'
    WHEN a.prev_hash = lag(a.row_hash) OVER (ORDER BY a."createdAt") THEN 'VALID'
    ELSE 'TAMPERED'
  END AS chain_status
FROM "AuditLog" a
ORDER BY a."createdAt"
LIMIT 1000;

\echo '══ 10. OPEN P1 INCIDENTS ══'
SELECT id, title, invariant, auto_heal_attempts, created_at, escalated_at
FROM incidents
WHERE priority = 'P1' AND status NOT IN ('RESOLVED','CLOSED')
ORDER BY created_at DESC;

\echo '══ 11. RECENT DRIFT SCORES ══'
SELECT score, components, created_at
FROM drift_scores
ORDER BY created_at DESC
LIMIT 10;

\echo '══ 12. BACKUP VALIDATION STATUS ══'
SELECT
  backup_file,
  backup_size_kb,
  restore_tested,
  drift_clean,
  status,
  validated_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - validated_at)) / 3600, 1) AS age_hours
FROM backup_validations
ORDER BY validated_at DESC
LIMIT 5;

\echo '══ 13. SYSTEM HEALTH SCORE TREND ══'
SELECT
  score,
  components->>'integrity'   AS integrity,
  components->>'errorRate'   AS error_rate,
  components->>'incidents'   AS incidents,
  components->>'backup'      AS backup,
  safe_mode,
  recorded_at
FROM health_scores
ORDER BY recorded_at DESC
LIMIT 24;

\echo '══ 14. SAFE MODE STATE ══'
SELECT safe_mode, safe_mode_reason, enabled_at, enabled_by, updated_at
FROM system_mode;

\echo '══ 15. SECURITY BLOCKS ACTIVE ══'
SELECT target, target_type, reason, blocked_at, expires_at
FROM security_blocks
WHERE expires_at > NOW() AND lifted_at IS NULL;

\echo '══ 16. INVARIANT VIOLATIONS LAST 24H ══'
SELECT
  invariant,
  COUNT(*)                                           AS violation_count,
  SUM(CASE WHEN auto_corrected THEN 1 ELSE 0 END)  AS auto_corrected,
  MAX(created_at)                                    AS last_seen
FROM invariant_violations
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY invariant
ORDER BY violation_count DESC;

\echo '══ 17. IDEMPOTENCY KEY STATS ══'
SELECT
  COUNT(*)                                             AS total_keys,
  SUM(CASE WHEN locked THEN 1 ELSE 0 END)            AS locked,
  SUM(CASE WHEN expires_at < NOW() THEN 1 ELSE 0 END) AS expired
FROM idempotency_keys;

\echo '══ 18. DB CONNECTION POOL ══'
SELECT
  state,
  COUNT(*) AS connections,
  ROUND(COUNT(*) * 100.0 / (SELECT setting::NUMERIC FROM pg_settings WHERE name = 'max_connections'), 1) AS pct_of_max
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state
ORDER BY connections DESC;

\echo '══ 19. SLOW QUERIES (pg_stat_statements) ══'
SELECT
  LEFT(query, 120)           AS query_snippet,
  ROUND(mean_exec_time::NUMERIC, 1) AS mean_ms,
  calls,
  ROUND(total_exec_time::NUMERIC / 1000, 1) AS total_sec
FROM pg_stat_statements
WHERE mean_exec_time > 200
  AND calls > 5
  AND query NOT LIKE '%pg_stat%'
ORDER BY mean_exec_time DESC
LIMIT 15;

\echo '══ ALL CHECKS COMPLETE ══'
