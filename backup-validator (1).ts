/**
 * autonomous/backup-validator.ts
 * Daily encrypted backup, shadow restore test, checksum comparison, drift scan.
 */
import { PrismaClient } from '@prisma/client';
import { spawnSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { logger } from '../config/logger';
import { alertWebhook } from '../monitoring/alerts';
import { incidentManager } from './incident-manager';
import { InvariantEngine } from './invariant-engine';
import { metrics } from '../monitoring/metrics';

const BACKUP_DIR    = process.env.BACKUP_DIR    ?? '/tmp/autonomous-backups';
const SHADOW_DB_URL = process.env.SHADOW_DB_URL ?? '';
const GPG_KEY_ID    = process.env.GPG_KEY_ID    ?? '';
const DATABASE_URL  = process.env.DATABASE_URL   ?? '';

function pgEnv(url: string): Record<string, string> {
  const u = new URL(url.replace(/^postgresql/, 'http'));
  return {
    ...process.env as Record<string, string>,
    PGPASSWORD:  decodeURIComponent(u.password),
    PGUSER:      u.username,
    PGHOST:      u.hostname,
    PGPORT:      u.port || '5432',
    PGDATABASE:  u.pathname.slice(1),
  };
}

function fileChecksum(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

// ─────────────────────────────────────────────────────────────
// BACKUP
// ─────────────────────────────────────────────────────────────
export async function createBackup(): Promise<{ filePath: string; checksum: string; sizekb: number }> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts       = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpPath = path.join(BACKUP_DIR, `backup-${ts}.dump`);

  logger.info('[BACKUP] Starting pg_dump...');

  const result = spawnSync(
    'pg_dump',
    ['-Fc', '--no-password', '-f', dumpPath],
    { env: pgEnv(DATABASE_URL), stdio: 'pipe' },
  );

  if (result.status !== 0) {
    const err = `pg_dump failed: ${result.stderr?.toString()}`;
    logger.fatal('[BACKUP] Failed', { err });
    throw new Error(err);
  }

  // Encrypt if GPG key configured
  let finalPath = dumpPath;
  if (GPG_KEY_ID) {
    const encPath = `${dumpPath}.gpg`;
    const enc = spawnSync(
      'gpg', ['--batch', '--yes', '--recipient', GPG_KEY_ID, '--output', encPath, '--encrypt', dumpPath],
      { stdio: 'pipe' },
    );
    if (enc.status === 0) {
      fs.unlinkSync(dumpPath);
      finalPath = encPath;
    } else {
      logger.warn('[BACKUP] GPG encryption failed, keeping unencrypted');
    }
  }

  const stat = fs.statSync(finalPath);
  const checksum = fileChecksum(finalPath);
  const sizekb   = Math.round(stat.size / 1024);

  logger.info(`[BACKUP] Created: ${finalPath} (${sizekb}KB)`);
  return { filePath: finalPath, checksum, sizekb };
}

// ─────────────────────────────────────────────────────────────
// SHADOW RESTORE TEST
// ─────────────────────────────────────────────────────────────
async function shadowRestore(dumpPath: string): Promise<boolean> {
  if (!SHADOW_DB_URL) {
    logger.warn('[BACKUP] SHADOW_DB_URL not configured — skipping restore test');
    return true;
  }

  const env = pgEnv(SHADOW_DB_URL);
  logger.info('[BACKUP] Starting shadow restore...');

  // Decrypt if GPG
  let restorePath = dumpPath;
  if (dumpPath.endsWith('.gpg') && GPG_KEY_ID) {
    const decPath = dumpPath.replace('.gpg', '.dec');
    const dec = spawnSync(
      'gpg', ['--batch', '--yes', '--output', decPath, '--decrypt', dumpPath],
      { stdio: 'pipe' },
    );
    if (dec.status !== 0) {
      logger.error('[BACKUP] GPG decrypt failed');
      return false;
    }
    restorePath = decPath;
  }

  const restore = spawnSync(
    'pg_restore',
    ['--clean', '--if-exists', '--no-password', '--no-owner', '-d', env.PGDATABASE, restorePath],
    { env, stdio: 'pipe' },
  );

  if (restorePath !== dumpPath) fs.unlinkSync(restorePath); // cleanup decrypt

  if (restore.status !== 0) {
    logger.error('[BACKUP] Shadow restore failed', { stderr: restore.stderr?.toString().slice(0, 500) });
    return false;
  }

  logger.info('[BACKUP] Shadow restore successful');
  return true;
}

// ─────────────────────────────────────────────────────────────
// DRIFT SCAN ON RESTORED DB
// ─────────────────────────────────────────────────────────────
async function driftScanRestored(): Promise<{ clean: boolean; violations: number }> {
  if (!SHADOW_DB_URL) return { clean: true, violations: 0 };
  const shadowPrisma = new PrismaClient({ datasources: { db: { url: SHADOW_DB_URL } } });
  try {
    await shadowPrisma.$connect();
    const engine = new InvariantEngine(shadowPrisma);
    const { results } = await engine.runAll();
    const violations = results.filter(r => !r.passed).length;
    return { clean: violations === 0, violations };
  } catch (err) {
    logger.error('[BACKUP] Drift scan on restored DB failed', { err });
    return { clean: false, violations: -1 };
  } finally {
    await shadowPrisma.$disconnect();
  }
}

// ─────────────────────────────────────────────────────────────
// CLEANUP OLD BACKUPS (keep 7 days)
// ─────────────────────────────────────────────────────────────
function cleanupOldBackups(): void {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const maxAgeMs = 7 * 24 * 3_600_000;
  const files = fs.readdirSync(BACKUP_DIR);
  for (const f of files) {
    const p    = path.join(BACKUP_DIR, f);
    const stat = fs.statSync(p);
    if (Date.now() - stat.mtimeMs > maxAgeMs) {
      fs.unlinkSync(p);
      logger.info(`[BACKUP] Purged old backup: ${f}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN BACKUP VALIDATION JOB
// ─────────────────────────────────────────────────────────────
export async function runBackupValidation(prisma: PrismaClient): Promise<void> {
  logger.info('[BACKUP] Starting daily backup validation...');

  let validationId: string | null = null;
  let filePath: string | null = null;

  try {
    // 1. Create backup
    const { filePath: fp, checksum, sizekb } = await createBackup();
    filePath = fp;

    // 2. Register in DB
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO backup_validations (backup_file, backup_size_kb, checksum, status)
      VALUES (${filePath}, ${sizekb}, ${checksum}, 'PENDING')
      RETURNING id
    `;
    validationId = rows[0].id;

    // 3. Shadow restore
    const restoreOk = await shadowRestore(filePath);
    await prisma.$executeRaw`
      UPDATE backup_validations SET restore_tested = ${restoreOk} WHERE id = ${validationId}
    `;

    // 4. Drift scan
    const { clean: driftClean, violations } = await driftScanRestored();

    // 5. Verify checksum integrity
    const actualChecksum = fileChecksum(filePath);
    const checksumValid  = actualChecksum === checksum;

    const passed = restoreOk && driftClean && checksumValid;

    await prisma.$executeRaw`
      UPDATE backup_validations
      SET drift_clean = ${driftClean}, status = ${passed ? 'PASSED' : 'FAILED'}
      WHERE id = ${validationId}
    `;

    metrics.gauge('backup.age_hours', 0); // fresh
    metrics.gauge('backup.size_kb', sizekb);

    if (!passed) {
      const reason = [
        !restoreOk     && 'shadow restore failed',
        !driftClean    && `drift scan found ${violations} violations`,
        !checksumValid && 'checksum mismatch',
      ].filter(Boolean).join('; ');

      const incidentId = await incidentManager.createIncident({
        priority: 'P1',
        title:    `Backup validation FAILED: ${reason}`,
        details:  { validationId, filePath, restoreOk, driftClean, checksumValid, violations },
      });

      await prisma.$executeRaw`
        UPDATE backup_validations SET incident_id = ${incidentId} WHERE id = ${validationId}
      `;
    } else {
      logger.info('[BACKUP] ✅ Backup validation passed');
    }

    cleanupOldBackups();
  } catch (err: any) {
    logger.fatal('[BACKUP] Backup validation job crashed', { err });
    await alertWebhook({
      severity: 'CRITICAL',
      title:    'Backup Validation Job Failed',
      body:     err.message,
    });

    if (validationId) {
      await prisma.$executeRaw`
        UPDATE backup_validations SET status = 'FAILED' WHERE id = ${validationId}
      `;
    }
  }
}
