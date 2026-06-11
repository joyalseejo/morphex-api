import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Per-model rates (USD per token)
const HAIKU_INPUT   = 0.00000025;
const HAIKU_OUTPUT  = 0.00000125;
const SONNET_INPUT  = 0.000003;
const SONNET_OUTPUT = 0.000015;

// Composable Prisma SQL fragment — each ${number} becomes a typed parameter,
// and this Prisma.sql object is inlined as SQL (not a string param) when
// interpolated into another $queryRaw template.
const COST_FRAGMENT = Prisma.sql`
  COALESCE(SUM(
    CASE COALESCE("modelUsed", "model")
      WHEN 'claude-haiku-4-5-20251001'
        THEN COALESCE("inputTokens",  0) * ${HAIKU_INPUT}
           + COALESCE("outputTokens", 0) * ${HAIKU_OUTPUT}
      WHEN 'claude-sonnet-4-6'
        THEN COALESCE("inputTokens",  0) * ${SONNET_INPUT}
           + COALESCE("outputTokens", 0) * ${SONNET_OUTPUT}
      ELSE COALESCE("inputTokens",  0) * ${HAIKU_INPUT}
         + COALESCE("outputTokens", 0) * ${HAIKU_OUTPUT}
    END
  ), 0)::float AS cost_usd
`;

function parseDate(str, fallback) {
  if (!str) return fallback;
  const d = new Date(str);
  return isNaN(d.getTime()) ? fallback : d;
}

// Default to current UTC calendar month so the `from` ISO string starts with the right month.
function defaultRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date();
  return { from, to };
}

// ─── GET /v1/usage ────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const defaults = defaultRange();
    const from = parseDate(req.query.from, defaults.from);
    const to   = parseDate(req.query.to,   defaults.to);

    const rows = await prisma.$queryRaw`
      SELECT
        DATE_TRUNC('day', "createdAt")              AS date,
        COUNT(*)::int                               AS extractions,
        COALESCE(SUM("inputTokens"),  0)::bigint    AS input_tokens,
        COALESCE(SUM("outputTokens"), 0)::bigint    AS output_tokens,
        ${COST_FRAGMENT}
      FROM "Extraction"
      WHERE "workspaceId" = ${req.workspace.id}
        AND "status"      = 'completed'
        AND "isSandbox"   = false
        AND "createdAt"  >= ${from}
        AND "createdAt"  <= ${to}
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY date DESC
    `;

    let totalExtractions  = 0;
    let totalInputTokens  = 0;
    let totalOutputTokens = 0;
    let totalCostUsd      = 0;

    const daily = rows.map(r => {
      const inp  = Number(r.input_tokens);
      const out  = Number(r.output_tokens);
      const ext  = Number(r.extractions);
      const cost = Number(r.cost_usd);
      totalExtractions  += ext;
      totalInputTokens  += inp;
      totalOutputTokens += out;
      totalCostUsd      += cost;
      return {
        date:        r.date.toISOString().slice(0, 10),
        extractions: ext,
        tokens:      inp + out,
        cost_usd:    parseFloat(cost.toFixed(6)),
      };
    });

    res.json({
      period:            { from: from.toISOString(), to: to.toISOString() },
      total_extractions: totalExtractions,
      total_tokens:      totalInputTokens + totalOutputTokens,
      total_cost_usd:    parseFloat(totalCostUsd.toFixed(6)),
      daily,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /v1/usage/current-month ──────────────────────────────────────────────

router.get('/current-month', async (req, res, next) => {
  try {
    const now        = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const agg = await prisma.extraction.aggregate({
      where: {
        workspaceId: req.workspace.id,
        status:      'completed',
        isSandbox:   false,
        createdAt:   { gte: monthStart },
      },
      _count: { id: true },
      _sum:   { inputTokens: true, outputTokens: true },
    });

    const [costRow] = await prisma.$queryRaw`
      SELECT ${COST_FRAGMENT}
      FROM "Extraction"
      WHERE "workspaceId" = ${req.workspace.id}
        AND "status"      = 'completed'
        AND "isSandbox"   = false
        AND "createdAt"  >= ${monthStart}
    `;

    res.json({
      month:             `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
      total_extractions: agg._count.id,
      total_tokens:      (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0),
      total_cost_usd:    parseFloat(Number(costRow?.cost_usd ?? 0).toFixed(6)),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /v1/usage/breakdown?by=schema ───────────────────────────────────────

router.get('/breakdown', async (req, res, next) => {
  try {
    const by = req.query.by ?? 'schema';

    if (by !== 'schema') {
      return res.status(400).json({
        error: { type: 'ValidationError', message: 'Only by=schema is supported' },
      });
    }

    const defaults = defaultRange();
    const from = parseDate(req.query.from, defaults.from);
    const to   = parseDate(req.query.to,   defaults.to);

    const rows = await prisma.$queryRaw`
      SELECT
        e."schemaId"                                  AS schema_id,
        s."name"                                      AS schema_name,
        COUNT(e.id)::int                              AS extractions,
        COALESCE(SUM(e."inputTokens"),  0)::bigint    AS input_tokens,
        COALESCE(SUM(e."outputTokens"), 0)::bigint    AS output_tokens,
        COALESCE(SUM(
          CASE COALESCE(e."modelUsed", e."model")
            WHEN 'claude-haiku-4-5-20251001'
              THEN COALESCE(e."inputTokens",  0) * ${HAIKU_INPUT}
                 + COALESCE(e."outputTokens", 0) * ${HAIKU_OUTPUT}
            WHEN 'claude-sonnet-4-6'
              THEN COALESCE(e."inputTokens",  0) * ${SONNET_INPUT}
                 + COALESCE(e."outputTokens", 0) * ${SONNET_OUTPUT}
            ELSE COALESCE(e."inputTokens",  0) * ${HAIKU_INPUT}
               + COALESCE(e."outputTokens", 0) * ${HAIKU_OUTPUT}
          END
        ), 0)::float AS cost_usd
      FROM "Extraction" e
      LEFT JOIN "Schema" s ON s.id = e."schemaId"
      WHERE e."workspaceId" = ${req.workspace.id}
        AND e."status"      = 'completed'
        AND e."isSandbox"   = false
        AND e."createdAt"  >= ${from}
        AND e."createdAt"  <= ${to}
      GROUP BY e."schemaId", s."name"
      ORDER BY extractions DESC
    `;

    const data = rows.map(r => ({
      schema_id:   r.schema_id,
      schema_name: r.schema_name ?? '(inline)',
      extractions: Number(r.extractions),
      tokens:      Number(r.input_tokens) + Number(r.output_tokens),
      cost_usd:    parseFloat(Number(r.cost_usd).toFixed(6)),
    }));

    res.json({
      by: 'schema',
      period: { from: from.toISOString(), to: to.toISOString() },
      data,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
