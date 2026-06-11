# morphex-api

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![Built with Claude](https://img.shields.io/badge/Built%20with-Claude-blueviolet.svg)](https://anthropic.com)

**Schema-defined data extraction API. Any text, image, or audio in → typed JSON matching your schema out.**

---

## Why Morphex?

- **Schema contract** — you define exactly what fields come back. No prompt engineering, no postprocessing. The API enforces every declared field is present (null if not found, never absent).
- **Per-field confidence scoring** — every response includes a confidence score per field so uncertain values are flagged before they corrupt downstream data.
- **Production reliability** — retry with corrective multi-turn prompting, dead-letter queue for failed extractions, webhook delivery logs with per-attempt status and response body.

---

## Quick Start

**Prerequisites:** Node.js 20+, PostgreSQL, Redis

```bash
git clone https://github.com/[username]/morphex-api.git
cd morphex-api
npm install
cp .env.example .env          # fill in DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY
npx prisma migrate deploy
npm run seed                  # seeds 7 built-in system schemas
npm run dev
```

Make your first extraction:

```bash
curl -X POST http://localhost:3002/v1/extract \
  -H "x-api-key: mx_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "input": "need 50 bags cement grade 53 calicut tuesday urgent",
    "schema": {
      "type": "object",
      "properties": {
        "product":  {"type": "string"},
        "quantity": {"type": "number"},
        "location": {"type": "string"},
        "urgency":  {"type": "string"}
      }
    }
  }'
```

Response:

```json
{
  "id": "cmq6abc123...",
  "status": "completed",
  "result": {
    "product":  "cement grade 53",
    "quantity": 50,
    "location": "calicut",
    "urgency":  "tuesday urgent"
  },
  "confidence": 0.94,
  "field_confidences": {
    "product":  0.99,
    "quantity": 0.99,
    "location": 0.95,
    "urgency":  0.82
  },
  "warnings": [],
  "meta": {
    "model":         "claude-haiku-4-5-20251001",
    "processing_ms": 1243,
    "input_tokens":  87,
    "output_tokens": 42
  }
}
```

---

## Pre-built Schemas

Pass `"schema_id": "<slug>"` instead of an inline schema object to use any of these.

| Slug | Category | Use case | Key fields |
|------|----------|----------|------------|
| `invoice-v1` | Finance | Invoice and purchase order extraction | `line_items`, `gst_amount`, `total`, `vendor`, `due_date` |
| `receipt-v1` | Retail | Receipt and bill extraction (image or text) | `items`, `tax`, `total`, `payment_method`, `merchant` |
| `purchase-order-v1` | Procurement | B2B order messages and emails | `product`, `quantity`, `delivery_date`, `buyer`, `supplier` |
| `support-ticket-v1` | Support | Support emails and chat messages | `issue_summary`, `priority`, `customer_name`, `product_area` |
| `lead-contact-v1` | Sales | Lead capture forms and inbound emails | `name`, `email`, `company`, `pain_points`, `budget` |
| `shipment-v1` | Logistics | Delivery requests and shipping instructions | `sender`, `recipient`, `items`, `weight`, `delivery_date` |
| `job-application-v1` | HR | CV, resume, and job application parsing | `skills`, `experience_years`, `education`, `current_role` |

```bash
# Using a pre-built schema
curl -X POST http://localhost:3002/v1/extract \
  -H "x-api-key: mx_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Invoice #INV-2024-001 from Acme Ltd. Total: $1,840 incl. GST.",
    "schema_id": "invoice-v1"
  }'
```

---

## Features

| Feature | Detail |
|---------|--------|
| **Input types** | Plain text, base64 image (JPEG/PNG/WebP/GIF), `image_url` |
| **Sandbox mode** | `mx_test_` keys return deterministic mock data — zero Anthropic API cost |
| **Async extraction** | Set `"async": true` to queue large jobs; poll `GET /v1/extract/:id` or receive via webhook |
| **Webhook delivery** | HMAC-signed `POST` to your endpoint; per-attempt log at `GET /v1/webhooks/deliveries` |
| **Schema versioning** | `POST /v1/schemas/:id/versions` to evolve schemas without breaking existing integrations |
| **Cost tracking** | Per-model token costs (Haiku vs Sonnet) available at `GET /v1/usage/current-month` |
| **Dead letter queue** | After 3 failures, extraction lands in DLQ; `POST /v1/extract/:id/retry` to re-queue |
| **Idempotency** | Pass `Idempotency-Key` header — identical requests return cached response for 24 hours |
| **Rate limiting** | Sliding-window per API key; tier-based limits (free: 100/min → enterprise: 10 000/min) |
| **Model routing** | Short text → Haiku (fast/cheap); long text or complex schema → Sonnet (automatic) |

---

## API Reference

### Authentication

Every request requires an `x-api-key` header. Create keys at `POST /v1/keys`.

```
x-api-key: mx_live_<token>   # live key — real Anthropic calls
x-api-key: mx_test_<token>   # sandbox key — mock responses, no API cost
```

### Core endpoints

```
POST   /v1/extract                  Run an extraction (sync or async)
GET    /v1/extract/:id              Poll extraction status
POST   /v1/extract/:id/retry        Re-queue a failed extraction

GET    /v1/schemas                  List available schemas
POST   /v1/schemas                  Create a custom schema
GET    /v1/schemas/:idOrSlug        Get schema by ID or slug
POST   /v1/schemas/:id/versions     Create a new schema version
POST   /v1/schemas/:id/deprecate    Deprecate a schema version
GET    /v1/schemas/:id/export       Download schema as JSON

GET    /v1/usage                    Daily usage breakdown
GET    /v1/usage/current-month      Month-to-date totals + cost
GET    /v1/usage/breakdown          Usage breakdown by schema

GET    /v1/webhooks/deliveries      Webhook delivery log
POST   /v1/webhooks/deliveries/:id/retry  Retry a failed webhook

GET    /v1/keys                     List API keys
POST   /v1/keys                     Create an API key
POST   /v1/keys/:id/rotate          Rotate key (old key immediately invalid)
DELETE /v1/keys/:id                 Revoke a key

GET    /health                      Health check (no auth)
```

---

## Self-Hosting

### Environment Variables

Copy `.env.example` to `.env` and fill in each value:

```bash
# Server
PORT=3000
NODE_ENV=development          # development | production | test

# PostgreSQL — use a pooled URL for DATABASE_URL (pgBouncer compatible)
# and a direct (non-pooled) URL for DIRECT_URL (used by migrations)
DATABASE_URL="postgresql://user:pass@host:5432/morphex?pgbouncer=true"
DIRECT_URL="postgresql://user:pass@host:5432/morphex"

# Redis — used by BullMQ (async queue) and the sliding-window rate limiter
REDIS_URL="redis://localhost:6379"
# For Upstash: REDIS_URL="rediss://default:token@host.upstash.io:6379"

# Anthropic Claude — powers all extractions
ANTHROPIC_API_KEY="sk-ant-..."

# Auth — minimum 32 characters, random
JWT_SECRET="a-very-long-random-secret-string-here"

# Stripe — required even in dev; use test-mode keys
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# CORS — origin allowed for browser clients
FRONTEND_URL="http://localhost:3001"

# Sentry — leave empty to disable error reporting
SENTRY_DSN=""
```

### Recommended providers

| Service | Provider |
|---------|----------|
| PostgreSQL | [Supabase](https://supabase.com) (free tier includes pgBouncer) |
| Redis | [Upstash](https://upstash.com) (serverless, free tier) |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) |
| Deploy | Railway, Render, Fly.io, or any Node.js host |

### Deploy to Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template)

The repo includes `railway.json`. After deploying, set all environment variables in the Railway dashboard and run the seed command from the Railway shell:

```bash
npm run seed
```

---

## Hosted Service

Don't want to manage infrastructure? **[morphex.dev](https://morphex.dev)** offers the fully managed version with:

- Managed PostgreSQL, Redis, and Claude API usage
- Pre-configured system schemas ready to use
- Usage dashboard with per-schema cost breakdown
- Webhook delivery monitoring
- Email support

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ (ESM) |
| API framework | Express 4 |
| Database | PostgreSQL via Prisma ORM |
| Queue / DLQ | BullMQ + Redis |
| AI | Anthropic Claude (Haiku + Sonnet) |
| Error tracking | Sentry |
| Payments | Stripe |
| Testing | Jest + Supertest |

---

## Running Tests

```bash
npm test                  # full suite (unit + integration)
npm run test:coverage     # with coverage report
```

Unit tests mock the Anthropic SDK — no API key needed. Integration tests run against your local database and use sandbox keys so no Anthropic calls are made.

```
Test Suites: 7 passed
Tests:       76 passed
src/services/:   89% statement coverage
src/middleware/: 74% statement coverage
```

---

## Contributing

Issues and PRs are welcome.

- **Bug reports** — open an issue with reproduction steps.
- **Feature requests** — open an issue before building, so we can align on the approach.
- **Pull requests** — one concern per PR; run `npm test` before opening.

Please open an issue before starting any large change so we can discuss the design first.

---

## License

[MIT](LICENSE)
