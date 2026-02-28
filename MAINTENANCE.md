# Indus Hardware — Maintenance Guide & 30-Day Checklist

## System Architecture

```
Railway Project: indus-hardware
├── indus-api      → Fastify + Prisma (Port 4000)
├── indus-web      → Next.js public website (Port 3000)
├── indus-erp      → Next.js internal ERP (Port 3001)
├── PostgreSQL      → Railway managed DB
└── Redis           → Railway managed Redis (idempotency only)
```

---

## Railway Deployment (Exact Steps)

### 1. Create Railway project
```bash
npm install -g @railway/cli
railway login
railway new indus-hardware
```

### 2. Add databases
```bash
# In Railway dashboard: New → Database → PostgreSQL
# In Railway dashboard: New → Database → Redis
# Copy connection strings to use below
```

### 3. Create three services
```bash
# In Railway dashboard:
# Service 1: indus-api   → GitHub → root → Dockerfile.api
# Service 2: indus-web   → GitHub → root → Dockerfile.web
# Service 3: indus-erp   → GitHub → root → Dockerfile.erp
```

### 4. Set environment variables for each service

**indus-api:**
```
DATABASE_URL          = (from Railway PostgreSQL)
REDIS_URL             = (from Railway Redis)
JWT_SECRET            = (run: openssl rand -hex 32)
NODE_ENV              = production
API_PORT              = 4000
SEED_ON_DEPLOY        = true   ← set to false after first deploy!
BACKUP_S3_BUCKET      = indus-backups
BACKUP_S3_REGION      = ap-south-1
AWS_ACCESS_KEY_ID     = (your AWS key)
AWS_SECRET_ACCESS_KEY = (your AWS secret)
SLACK_WEBHOOK_URL     = (optional)
```

**indus-web:**
```
NEXT_PUBLIC_API_URL   = https://indus-api.railway.app
NEXT_PUBLIC_SITE_URL  = https://www.indusmaterials.com
```

**indus-erp:**
```
NEXT_PUBLIC_ERP_API_URL = https://indus-api.railway.app
```

### 5. Set GitHub secrets (for CI/CD)
```
RAILWAY_TOKEN  → Settings → Tokens → New Token
API_URL        → https://indus-api.railway.app
SLACK_WEBHOOK_URL → (optional)
```

### 6. First-time database setup
```bash
# SSH into Railway API service shell, or run locally pointing at prod DB:
DATABASE_URL="postgresql://..." npm run db:migrate
DATABASE_URL="postgresql://..." npm run db:seed
```

### 7. Configure Railway health checks
- indus-api: Path = `/health`, Timeout = 30s
- indus-web: Path = `/`, Timeout = 30s
- indus-erp: Path = `/`, Timeout = 30s

### 8. Set up custom domains (optional)
```
indus-web → www.indusmaterials.com
indus-erp → erp.indusmaterials.com
indus-api → api.indusmaterials.com
```

---

## GitHub Workflow

```
push to main → GitHub Actions runs:
  1. Type check all apps
  2. Deploy API → wait for /health
  3. Deploy Web + ERP (parallel)
  4. Slack notification
```

**Required secrets in GitHub → Settings → Secrets:**
- `RAILWAY_TOKEN` — from Railway dashboard
- `API_URL` — your API Railway URL
- `SLACK_WEBHOOK_URL` — optional

---

## Daily Backup Setup

### Option A: Railway Cron (recommended)
In Railway dashboard, add a cron service:
```
Schedule: 0 2 * * *   (2 AM IST)
Command:  bash scripts/backup.sh
```

### Option B: System crontab
```bash
0 2 * * * DATABASE_URL=... BACKUP_S3_BUCKET=indus-backups bash /app/scripts/backup.sh >> /var/log/indus-backup.log 2>&1
```

---

## 30-Day Operational Checklist

### Week 1 (Days 1–7) — Go-Live

- [ ] Day 1: Deploy all three services to Railway
- [ ] Day 1: Verify /health endpoint returns 200
- [ ] Day 1: Login to ERP with admin credentials, change default password
- [ ] Day 1: Create shop manager accounts for each branch
- [ ] Day 1: Verify first test sale goes through correctly
- [ ] Day 2: Set SEED_ON_DEPLOY=false in Railway env vars
- [ ] Day 2: Configure custom domain for website
- [ ] Day 2: Test payment modes: Cash, UPI, Credit
- [ ] Day 3: Run backup script manually, verify S3 file exists
- [ ] Day 3: Test void/return flow on a test sale
- [ ] Day 4: Add real customer accounts with credit limits
- [ ] Day 5: Review low-stock items, place first reorders
- [ ] Day 7: Check Railway logs for any errors or warnings

### Week 2 (Days 8–14) — Stabilize

- [ ] Day 8: Verify backup ran automatically overnight
- [ ] Day 9: Check dashboard revenue figures match manual records
- [ ] Day 10: Review outstanding credit report, follow up on collections
- [ ] Day 11: Test: add stock via inventory purchase endpoint
- [ ] Day 12: Verify GitHub Actions deployed successfully on last push
- [ ] Day 14: Weekly revenue reconciliation (ERP vs. cash register)

### Week 3 (Days 15–21) — Monitor

- [ ] Day 15: Review Railway metrics (CPU, memory, request count)
- [ ] Day 15: Check Redis memory usage (should be minimal)
- [ ] Day 16: Verify all user accounts have changed default passwords
- [ ] Day 18: Test disaster recovery: restore latest backup to staging DB
- [ ] Day 21: Monthly credit statement review with customers

### Week 4 (Days 22–30) — Optimize

- [ ] Day 22: Review top-selling products report
- [ ] Day 23: Update sale prices for any products that changed cost
- [ ] Day 24: Clean up voided sales older than 30 days if needed
- [ ] Day 25: Verify Slack alerts are working (if configured)
- [ ] Day 28: Railway usage review — check if plan limits are sufficient
- [ ] Day 30: Full system review meeting with shop managers

---

## Common Operations

### Add a new product
```bash
curl -X POST https://api.indusmaterials.com/api/inventory/products \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"New Product","sku":"PROD-001","categoryId":"...","unit":"pc"}'
```

### Add stock (purchase)
```bash
curl -X POST https://api.indusmaterials.com/api/inventory/purchase \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"shopId":"shop-main-001","items":[{"productId":"...","quantity":100}]}'
```

### Check system health
```bash
curl https://api.indusmaterials.com/health
```

### Run manual backup
```bash
DATABASE_URL="..." BACKUP_S3_BUCKET="indus-backups" bash scripts/backup.sh
```

### Restore from backup
```bash
# Download from S3
aws s3 cp s3://indus-backups/daily/indus-backup-YYYYMMDD.sql.gz /tmp/restore.sql.gz

# Restore
gunzip -c /tmp/restore.sql.gz | psql "$DATABASE_URL"
```

---

## Default Credentials (CHANGE IMMEDIATELY)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@indusmaterials.com | Admin@Indus2025 |
| Main Branch Manager | main@indusmaterials.com | Shop@Main2025 |
| Branch 2 Manager | branch2@indusmaterials.com | Shop@Branch2025 |

**Change passwords via:**
```bash
curl -X POST https://api.indusmaterials.com/api/auth/change-password \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"...","newPassword":"..."}'
```

---

## Environment Variable Reference

| Variable | Service | Required | Description |
|----------|---------|----------|-------------|
| DATABASE_URL | API | ✅ | PostgreSQL connection string |
| REDIS_URL | API | ✅ | Redis connection string |
| JWT_SECRET | API | ✅ | Min 32 chars random string |
| NODE_ENV | API | ✅ | Set to `production` |
| API_PORT | API | — | Default 4000 |
| SEED_ON_DEPLOY | API | — | `true` first deploy only |
| BACKUP_S3_BUCKET | API | Backup | S3 bucket name |
| BACKUP_S3_REGION | API | Backup | Default ap-south-1 |
| AWS_ACCESS_KEY_ID | API | Backup | AWS credentials |
| AWS_SECRET_ACCESS_KEY | API | Backup | AWS credentials |
| SLACK_WEBHOOK_URL | API | — | Alert notifications |
| NEXT_PUBLIC_API_URL | Web | ✅ | API base URL |
| NEXT_PUBLIC_SITE_URL | Web | ✅ | Website canonical URL |
| NEXT_PUBLIC_ERP_API_URL | ERP | ✅ | API base URL for ERP |

---

## Troubleshooting

**API returns 503:**
- Check Railway logs: `railway logs --service indus-api`
- Verify DATABASE_URL is set correctly
- Check PostgreSQL service is running in Railway

**Login fails in ERP:**
- Verify NEXT_PUBLIC_ERP_API_URL points to correct API
- Check CORS settings include ERP domain
- Check API logs for auth errors

**Stock not deducting:**
- Ensure sale is POST to `/api/sales` with correct shopId
- Verify product exists in StockLedger for that shop
- Check API logs for transaction errors

**Idempotency not working:**
- Verify Redis is connected (check /health endpoint)
- Pass `Idempotency-Key` header on POST requests

**Build fails on Railway:**
- Check node version is 20+
- Verify Dockerfile path matches railway.json
- Check package-lock.json is committed
