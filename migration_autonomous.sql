-- ════════════════════════════════════════════════════════════════
-- AUTONOMOUS PLATFORM SCHEMA MIGRATION
-- Run: psql $DATABASE_URL -f migration_autonomous.sql
-- ════════════════════════════════════════════════════════════════

-- ── Idempotency key registry ─────────────────────────────────
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id             TEXT PRIMARY KEY,
  response_body  JSONB,
  status_code    INT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  locked         BOOLEAN DEFAULT FALSE,
  locked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_locked  ON idempotency_keys (locked, created_at);

-- ── Incident model ────────────────────────────────────────────
CREATE TYPE IF NOT EXISTS incident_priority AS ENUM ('P1','P2','P3','P4');
CREATE TYPE IF NOT EXISTS incident_status   AS ENUM ('OPEN','AUTO_HEALING','ESCALATED','RESOLVED','CLOSED');

CREATE TABLE IF NOT EXISTS incidents (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  priority         incident_priority NOT NULL DEFAULT 'P3',
  status           incident_status   NOT NULL DEFAULT 'OPEN',
  title            TEXT NOT NULL,
  invariant        TEXT,
  details          JSONB NOT NULL DEFAULT '{}',
  forensic_snapshot JSONB,
  auto_heal_attempts INT DEFAULT 0,
  auto_healed      BOOLEAN DEFAULT FALSE,
  resolved_by      TEXT,
  resolved_reason  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  escalated_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_incidents_status    ON incidents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_priority  ON incidents (priority, status);
CREATE INDEX IF NOT EXISTS idx_incidents_invariant ON incidents (invariant, created_at DESC);

-- ── Invariant violations audit ────────────────────────────────
CREATE TABLE IF NOT EXISTS invariant_violations (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  invariant    TEXT NOT NULL,
  shop_id      TEXT,
  entity_id    TEXT,
  entity_type  TEXT,
  drift_score  NUMERIC(10,4) DEFAULT 0,
  details      JSONB NOT NULL DEFAULT '{}',
  auto_corrected BOOLEAN DEFAULT FALSE,
  correction   JSONB,
  incident_id  TEXT REFERENCES incidents(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invariant_violations_invariant  ON invariant_violations (invariant, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invariant_violations_shop       ON invariant_violations (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invariant_violations_corrected  ON invariant_violations (auto_corrected);

-- ── Drift score history ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS drift_scores (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  score      NUMERIC(6,2) NOT NULL,
  components JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drift_scores_time ON drift_scores (created_at DESC);

-- ── Security events ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_events (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  event_type   TEXT NOT NULL,
  ip_address   TEXT,
  user_id      TEXT,
  details      JSONB NOT NULL DEFAULT '{}',
  severity     TEXT NOT NULL DEFAULT 'MEDIUM',
  auto_blocked BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_ip   ON security_events (ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events (user_id, created_at DESC);

-- ── Temporary blocks ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_blocks (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  target     TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL, -- 'ip' | 'user_id'
  reason     TEXT NOT NULL,
  blocked_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  lifted_at  TIMESTAMPTZ,
  lifted_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_security_blocks_target  ON security_blocks (target, expires_at);
CREATE INDEX IF NOT EXISTS idx_security_blocks_expires ON security_blocks (expires_at);

-- ── Audit log tamper detection ────────────────────────────────
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS row_hash TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS prev_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_hash ON "AuditLog" (row_hash);

-- ── Performance observations ──────────────────────────────────
CREATE TABLE IF NOT EXISTS perf_observations (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  endpoint     TEXT NOT NULL,
  p95_ms       NUMERIC(10,2),
  p99_ms       NUMERIC(10,2),
  sample_count INT,
  slow_query   TEXT,
  index_suggestion TEXT,
  observed_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_perf_endpoint ON perf_observations (endpoint, observed_at DESC);

-- ── Backup validation log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS backup_validations (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  backup_file    TEXT NOT NULL,
  backup_size_kb BIGINT,
  checksum       TEXT,
  restore_tested BOOLEAN DEFAULT FALSE,
  drift_clean    BOOLEAN,
  incident_id    TEXT REFERENCES incidents(id),
  validated_at   TIMESTAMPTZ DEFAULT NOW(),
  status         TEXT NOT NULL DEFAULT 'PENDING' -- PENDING|PASSED|FAILED
);
CREATE INDEX IF NOT EXISTS idx_backup_validations_status ON backup_validations (status, validated_at DESC);

-- ── System health score history ───────────────────────────────
CREATE TABLE IF NOT EXISTS health_scores (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  score        NUMERIC(5,2) NOT NULL,
  components   JSONB NOT NULL DEFAULT '{}',
  safe_mode    BOOLEAN DEFAULT FALSE,
  recorded_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_health_scores_time ON health_scores (recorded_at DESC);

-- ── Executive report log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS executive_reports (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  period_date  DATE NOT NULL UNIQUE,
  report       JSONB NOT NULL,
  dispatched   BOOLEAN DEFAULT FALSE,
  dispatched_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exec_reports_date ON executive_reports (period_date DESC);

-- ── Safe mode state ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_mode (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  safe_mode       BOOLEAN DEFAULT FALSE,
  safe_mode_reason TEXT,
  enabled_at      TIMESTAMPTZ,
  enabled_by      TEXT,
  override_token  TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO system_mode (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ── Deployment gates log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS deployment_gates (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  passed      BOOLEAN NOT NULL,
  gates       JSONB NOT NULL DEFAULT '[]',
  blockers    JSONB NOT NULL DEFAULT '[]',
  triggered_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════
-- FUNCTIONS & TRIGGERS
-- ════════════════════════════════════════════════════════════════

-- Auto-update incidents.updated_at
CREATE OR REPLACE FUNCTION set_incident_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_incident_updated ON incidents;
CREATE TRIGGER trg_incident_updated
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_incident_updated_at();

-- Prevent negative quantityOnHand in StockLedger
CREATE OR REPLACE FUNCTION enforce_non_negative_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."quantityOnHand" < 0 THEN
    RAISE EXCEPTION 'INVARIANT_VIOLATION: quantityOnHand cannot be negative for stockLedger %', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_stock_non_negative ON "StockLedger";
CREATE TRIGGER trg_stock_non_negative
  BEFORE INSERT OR UPDATE ON "StockLedger"
  FOR EACH ROW EXECUTE FUNCTION enforce_non_negative_stock();

-- Audit log chained hash
CREATE OR REPLACE FUNCTION compute_audit_chain_hash()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  prev TEXT;
BEGIN
  SELECT row_hash INTO prev FROM "AuditLog"
    WHERE id <> NEW.id ORDER BY "createdAt" DESC LIMIT 1;
  NEW.prev_hash  := COALESCE(prev, 'GENESIS');
  NEW.row_hash   := encode(
    sha256((NEW.prev_hash || NEW.id || NEW.action || NEW."entityType" || NEW."entityId" || NOW()::TEXT)::BYTEA),
    'hex'
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_chain ON "AuditLog";
CREATE TRIGGER trg_audit_chain
  BEFORE INSERT ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION compute_audit_chain_hash();
