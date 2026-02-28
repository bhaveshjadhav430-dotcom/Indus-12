# Autonomous Platform — Architecture & Operations Guide

## System Map

```
┌─────────────────────────────────────────────────────────────┐
│                    REQUEST LAYER                             │
│  Safe Mode MW → Security MW → Latency Tracker → Handler     │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                  AUTONOMOUS CORE                             │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ InvariantEng │  │ IncidentMgr  │  │ SecurityEngine   │  │
│  │ 7 invariants │  │ P1–P4 model  │  │ brute/rate/audit │  │
│  │ drift scorer │  │ auto-resolve │  │ auto-block       │  │
│  │ auto-correct │  │ escalate     │  │ tamper detect    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                  │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────────────────┐  │
│  │ PerfEngine   │  │ HealthScore  │  │ BackupValidator  │  │
│  │ p95/p99      │  │ 0–100 score  │  │ encrypt+restore  │  │
│  │ slow queries │  │ safe mode    │  │ drift scan       │  │
│  │ mem trend    │  │ auto-F gate  │  │ checksum verify  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  CronScheduler (all workers)                          │  │
│  │  invariant:5m · perf:10m · security:15m · health:5m  │  │
│  │  backup:24h · exec-report:24h · idempotency-clean:1h │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Invariants (Continuous)

| Invariant | Priority | Auto-Correct |
|-----------|----------|--------------|
| NO_NEGATIVE_STOCK | P1 | ❌ Escalate |
| SALE_TOTAL_MATCHES_LINE_ITEMS | P1 | ❌ Escalate |
| PAYMENT_SUM_MATCHES_SALE_TOTAL | P1 | ❌ Escalate |
| NO_DUPLICATE_INVOICES | P1 | ❌ Escalate |
| STOCK_MOVEMENT_BALANCE | P2 | ❌ Escalate |
| CREDIT_LIMIT_NOT_EXCEEDED | P2 | ❌ Escalate |
| NO_ORPHANED_SALE_ITEMS | P3 | ✅ Delete orphans |

## Incident Lifecycle

```
Invariant violation detected
        ↓
  Create P1–P4 incident + forensic snapshot + alert
        ↓
  AUTO_HEALING: increment attempts, retry on next cycle
        ↓
  if (attempts ≥ 3 || age > 15min) → ESCALATE → PagerDuty
        ↓
  if (violation clears) → RESOLVED (auto_healed=true)
```

## Health Score (0–100)

| Component | Max | Logic |
|-----------|-----|-------|
| integrity | 30 | drift_score/100 × 30 |
| error_rate | 20 | decreasing scale |
| latency | 15 | p95 bands |
| incidents | 20 | −10/P1, −5/P2, −2/P3 |
| backup | 10 | age-based |
| migrations | 5 | all applied = 5 |

Grade F (<40) → **auto-engage safe mode**.

## Deployment Gates

All must pass before deploy proceeds:

1. `NO_OPEN_P1_INCIDENTS` — zero open P1s
2. `DRIFT_SCORE` — ≥ 85/100
3. `TEST_COVERAGE` — ≥ 85% line coverage
4. `BACKUP_FRESHNESS` — last valid backup < 24h
5. `ERROR_RATE` — current error rate ≤ 3%
6. `MIGRATIONS_CLEAN` — no pending migrations

Auto-rollback triggers if post-deploy:
- Error rate > 3% sustained for 60s
- p95 latency > 2× baseline sustained for 60s

## Safe Mode

Safe mode disables **all write endpoints** (POST/PUT/PATCH/DELETE).

**Enable:**
```bash
curl -X POST https://api/system-mode/safe \
  -H 'Content-Type: application/json' \
  -d '{"reason":"manual intervention","enabledBy":"ops@example.com"}'
```

**Disable (requires override token):**
```bash
# Set token first in DB:
psql $DATABASE_URL -c "UPDATE system_mode SET override_token = 'your-secret' WHERE id = 1"

# Then disable:
curl -X DELETE https://api/system-mode/safe \
  -H 'Content-Type: application/json' \
  -d '{"overrideToken":"your-secret","disabledBy":"ops@example.com"}'
```

## Key Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /system-health` | Full health report (0–100 score, grade, components) |
| `GET /incidents` | Open incidents by priority |
| `GET /invariants/status` | Drift score + recent violations |
| `GET /cron/status` | All background job statuses |
| `GET /metrics` | Prometheus exposition |
| `GET /metrics/json` | JSON metrics snapshot |
| `POST /reports/executive` | Trigger executive summary |
| `POST /system-mode/safe` | Enable safe mode |
| `DELETE /system-mode/safe` | Disable safe mode |

## Schema Changes

Run once after deploy:
```bash
psql $DATABASE_URL -f prisma/migration_autonomous.sql
```

New tables: `idempotency_keys`, `incidents`, `invariant_violations`, `drift_scores`,
`security_events`, `security_blocks`, `perf_observations`, `backup_validations`,
`health_scores`, `executive_reports`, `system_mode`, `deployment_gates`

New columns on `AuditLog`: `row_hash`, `prev_hash` (tamper-detection chain)

New DB trigger: Non-negative stock enforced at DB level on `StockLedger`.

## Environment Variables

```bash
# Core
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
PORT=3000
NODE_ENV=production

# Alerts
ALERT_WEBHOOK_URL=https://...
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
PAGERDUTY_ROUTING_KEY=...
EXECUTIVE_WEBHOOK_URL=https://...

# Backup
BACKUP_DIR=/var/backups/indus
SHADOW_DB_URL=postgresql://...  # for restore test
GPG_KEY_ID=ops@example.com      # optional encryption

# Intervals (milliseconds)
INVARIANT_INTERVAL_MS=300000    # 5 min
PERF_INTERVAL_MS=600000         # 10 min
SECURITY_INTERVAL_MS=900000     # 15 min
HEALTH_INTERVAL_MS=300000       # 5 min
BACKUP_INTERVAL_MS=86400000     # 24h
EXEC_REPORT_INTERVAL_MS=86400000

# Deployment
MONITORING_HEALTH_URL=https://api/metrics/json
```

## Verification

```bash
# Full integrity scan
npm run verify

# Specific check
psql $DATABASE_URL -c "SELECT * FROM incidents WHERE status NOT IN ('RESOLVED','CLOSED')"

# Health score
curl https://api/system-health | jq '{score, grade, safeMode}'

# Drift score
psql $DATABASE_URL -c "SELECT score FROM drift_scores ORDER BY created_at DESC LIMIT 1"
```
