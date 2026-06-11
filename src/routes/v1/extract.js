import { Router } from 'express';
import { z } from 'zod';
import { Queue } from 'bullmq';
import * as Sentry from '@sentry/node';
import { PrismaClient } from '@prisma/client';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import idempotency from '../../middleware/idempotency.js';
import { NotFoundError, RateLimitError } from '../../middleware/errors.js';
import { extract } from '../../services/extractor.js';
import { mockExtract } from '../../services/mockExtractor.js';
import { selectModel } from '../../services/modelRouter.js';
import { EXTRACTION_QUEUE, JOB_DEFAULTS } from '../../workers/extractionWorker.js';
import { config } from '../../config/index.js';
import logger from '../../utils/logger.js';

const router = Router();
const testRouter = Router();
const prisma = new PrismaClient();

const extractQueue = new Queue(EXTRACTION_QUEUE, {
  connection: { url: config.REDIS_URL },
});

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const imageSchema = z.object({
  data: z.string().min(1, 'image.data must not be empty'),
  media_type: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
});

const optionsSchema = z.object({
  model: z.string().optional(),
  async: z.boolean().default(false),
  webhook_url: z.string().url('options.webhook_url must be a valid URL').optional(),
  max_retries: z.number().int().min(0).max(5).default(2),
}).default({});

const extractBodySchema = z
  .object({
    input: z.string().min(1).max(100_000).optional(),
    image: imageSchema.optional(),
    image_url: z.string().url('image_url must be a valid URL').optional(),
    schema: z.record(z.unknown()).optional(),
    schema_id: z.string().optional(),
    options: optionsSchema,
  })
  .refine(d => d.input || d.image || d.image_url, {
    message: 'At least one of input, image, or image_url is required',
    path: ['input'],
  })
  .refine(d => d.schema || d.schema_id, {
    message: 'Either schema or schema_id is required',
    path: ['schema'],
  });

const testBodySchema = z
  .object({
    input: z.string().min(1).max(10_000).optional(),
    image: imageSchema.optional(),
    image_url: z.string().url().optional(),
    schema: z.record(z.unknown()),  // inline only — no schema_id for test endpoint
  })
  .refine(d => d.input || d.image || d.image_url, {
    message: 'At least one of input, image, or image_url is required',
    path: ['input'],
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveSchema(prismaClient, schemaId, schemaInline, workspaceId) {
  if (schemaId) {
    const stored = await prismaClient.schema.findFirst({
      where: {
        id: schemaId,
        OR: [{ workspaceId }, { isSystem: true }],
      },
    });
    if (!stored) throw new NotFoundError(`Schema ${schemaId} not found`);

    let deprecationWarning = null;
    if (stored.isDeprecated) {
      const latest = await prismaClient.schema.findFirst({
        where: {
          slug: stored.slug,
          isLatest: true,
          OR: [{ workspaceId }, { isSystem: true }],
        },
      });
      const migrateTo = latest && latest.id !== stored.id
        ? ` Migrate to v${latest.version} (id: ${latest.id}).`
        : '';
      deprecationWarning = `Schema ${stored.slug} v${stored.version} is deprecated.${migrateTo}${stored.deprecationMessage ? ' ' + stored.deprecationMessage : ''}`;
    }

    return { jsonSchema: stored.jsonSchema, schemaDbId: stored.id, inlineSchema: null, deprecationWarning };
  }
  return { jsonSchema: schemaInline, schemaDbId: null, inlineSchema: schemaInline, deprecationWarning: null };
}

async function fetchImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image from URL: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return { data: base64, media_type: contentType.split(';')[0].trim() };
}

function formatExtraction(extraction) {
  const base = {
    id: extraction.id,
    status: extraction.status,
    created_at: extraction.createdAt,
  };
  if (extraction.status === 'completed') {
    return {
      ...base,
      result: extraction.result,
      confidence: extraction.confidence,
      field_confidences: extraction.fieldConfidences,
      warnings: extraction.warnings ?? [],
      meta: {
        model: extraction.model,
        processing_ms: extraction.processingMs,
        input_tokens: extraction.inputTokens,
        output_tokens: extraction.outputTokens,
      },
    };
  }
  if (extraction.status === 'failed') {
    return { ...base, error: extraction.errorMessage };
  }
  return base;
}

// ─── POST /v1/extract ─────────────────────────────────────────────────────────

router.post('/', rateLimit, idempotency, validate(extractBodySchema), async (req, res, next) => {
  try {
    const { input, image, image_url, schema: inlineSchema, schema_id, options } = req.body;
    const workspace = req.workspace;

    // Resolve schema
    const { jsonSchema, schemaDbId, inlineSchema: storedInline, deprecationWarning } = await resolveSchema(
      prisma, schema_id, inlineSchema, workspace.id
    );

    // Resolve image
    let inputImage = null;
    if (image) {
      inputImage = { base64: image.data, mediaType: image.media_type };
    } else if (image_url) {
      const fetched = await fetchImageAsBase64(image_url);
      inputImage = { base64: fetched.data, mediaType: fetched.media_type };
    }

    const inputText = input ?? '';

    // Create extraction record
    const extraction = await prisma.extraction.create({
      data: {
        workspaceId: workspace.id,
        schemaId: schemaDbId,
        inlineSchema: storedInline,
        apiKeyId: req.apiKey.id,
        inputText,
        inputType: inputImage ? 'image' : 'text',
        status: options.async ? 'queued' : 'processing',
        webhookUrl: options.webhook_url ?? null,
        isSandbox: req.isSandbox ?? false,
      },
    });

    // Sandbox — return mock data instantly, no AI call, no queue
    if (req.isSandbox) {
      const { data, meta } = await mockExtract(inputText, jsonSchema);
      const warnings = [...(deprecationWarning ? [deprecationWarning] : []), ...(meta.warnings ?? [])];
      await prisma.extraction.update({
        where: { id: extraction.id },
        data: {
          status: 'completed',
          result: data,
          confidence: meta.confidence,
          fieldConfidences: meta.fieldConfidences,
          warnings,
          model: meta.model,
          inputTokens: meta.inputTokens,
          outputTokens: meta.outputTokens,
          processingMs: meta.processingMs,
        },
      });
      await prisma.extraction.update({
        where: { id: extraction.id },
        data: { modelUsed: meta.model },
      });
      return res.status(200).json({
        id: extraction.id,
        status: 'completed',
        result: data,
        confidence: meta.confidence,
        field_confidences: meta.fieldConfidences,
        warnings,
        meta: {
          model: meta.model,
          processing_ms: meta.processingMs,
          input_tokens: meta.inputTokens,
          output_tokens: meta.outputTokens,
          sandbox: true,
        },
      });
    }

    if (options.async) {
      // Choose priority and timeout based on plan + likely model
      const { model: modelHint } = selectModel(inputText, jsonSchema, !!inputImage);
      const jobTimeout = modelHint.includes('haiku') ? 30_000 : 60_000;
      const priority   = ['growth', 'enterprise'].includes(workspace.plan) ? 1 : 10;

      await extractQueue.add(
        'extract',
        {
          extractionId: extraction.id,
          inputText,
          inputImage,
          schema: jsonSchema,
          options: { model: options.model, maxRetries: options.max_retries },
          deprecationWarning: deprecationWarning ?? null,
        },
        {
          jobId: extraction.id,
          priority,
          timeout: jobTimeout,
          ...JOB_DEFAULTS,
        }
      );

      return res.status(202).json({
        id: extraction.id,
        status: 'queued',
        message: 'Extraction queued. Poll GET /v1/extract/:id or receive via webhook.',
      });
    }

    // Synchronous path — traced with Sentry
    let extractResult;
    try {
      extractResult = await Sentry.startSpan(
        {
          name: 'extract',
          op: 'ai.extraction',
          attributes: {
            'schema_id':   schemaDbId ?? 'inline',
            'input_type':  inputImage ? 'image' : 'text',
            'workspace_id': workspace.id,
          },
        },
        () => extract(inputText, jsonSchema, {
          model: options.model,
          inputImage,
          maxRetries: options.max_retries,
          inputType: inputImage ? 'image' : 'text',
        })
      );
    } catch (err) {
      await prisma.extraction.update({
        where: { id: extraction.id },
        data: { status: 'failed', errorMessage: err.message },
      });
      throw err;
    }

    const { data, meta } = extractResult;
    const warnings = [...(deprecationWarning ? [deprecationWarning] : []), ...(meta.warnings ?? [])];

    await prisma.extraction.update({
      where: { id: extraction.id },
      data: {
        status:          'completed',
        result:          data,
        confidence:      meta.confidence,
        fieldConfidences: meta.fieldConfidences,
        warnings,
        model:           meta.model,
        modelUsed:       meta.model,
        inputTokens:     meta.inputTokens,
        outputTokens:    meta.outputTokens,
        processingMs:    meta.processingMs,
      },
    });

    logger.info('Sync extraction completed', {
      extractionId: extraction.id,
      workspaceId: workspace.id,
      model: meta.model,
      confidence: meta.confidence,
    });

    res.status(200).json({
      id: extraction.id,
      status: 'completed',
      result: data,
      confidence: meta.confidence,
      field_confidences: meta.fieldConfidences,
      warnings,
      meta: {
        model: meta.model,
        processing_ms: meta.processingMs,
        input_tokens: meta.inputTokens,
        output_tokens: meta.outputTokens,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /v1/extract — paginated list ─────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
    const cursor = req.query.cursor ?? null;
    const status = req.query.status ?? null;

    const where = {
      workspaceId: req.workspace.id,
      ...(status && { status }),
      ...(cursor && { id: { lt: cursor } }),
    };

    const extractions = await prisma.extraction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        status: true,
        confidence: true,
        model: true,
        processingMs: true,
        inputTokens: true,
        outputTokens: true,
        result: true,
        fieldConfidences: true,
        warnings: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    const hasMore = extractions.length > limit;
    const items = hasMore ? extractions.slice(0, limit) : extractions;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    res.json({
      data: items.map(e => formatExtraction(e)),
      meta: {
        count: items.length,
        has_more: hasMore,
        next_cursor: nextCursor,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /v1/extract/:id — poll single extraction ─────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const extraction = await prisma.extraction.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id },
    });

    if (!extraction) {
      throw new NotFoundError(`Extraction ${req.params.id} not found`);
    }

    res.json(formatExtraction(extraction));
  } catch (err) {
    next(err);
  }
});

// ─── POST /v1/extract/:id/retry — re-queue a failed extraction ───────────────

router.post('/:id/retry', async (req, res, next) => {
  try {
    const extraction = await prisma.extraction.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id, status: 'failed' },
    });

    if (!extraction) {
      throw new NotFoundError(`Failed extraction ${req.params.id} not found`);
    }

    if (extraction.inputType === 'image') {
      return res.status(400).json({
        error: { type: 'ValidationError', message: 'Image extractions cannot be retried — image data is not stored' },
      });
    }

    // Resolve the schema that was used originally
    let jsonSchema = extraction.inlineSchema;
    if (extraction.schemaId) {
      const schemaRecord = await prisma.schema.findFirst({
        where: { id: extraction.schemaId, OR: [{ workspaceId: req.workspace.id }, { isSystem: true }] },
      });
      if (!schemaRecord) {
        return res.status(400).json({
          error: { type: 'ValidationError', message: 'Original schema is no longer accessible' },
        });
      }
      jsonSchema = schemaRecord.jsonSchema;
    }

    if (!jsonSchema) {
      return res.status(400).json({
        error: { type: 'ValidationError', message: 'Cannot retry: schema not resolvable' },
      });
    }

    await prisma.extraction.update({
      where: { id: req.params.id },
      data: { status: 'queued', errorMessage: null },
    });

    // Use a timestamped jobId so BullMQ doesn't deduplicate against the original failed job
    await extractQueue.add(
      'extract',
      {
        extractionId: extraction.id,
        inputText:    extraction.inputText,
        inputImage:   null,
        schema:       jsonSchema,
        options:      {},
        deprecationWarning: null,
      },
      { jobId: `retry:${extraction.id}:${Date.now()}`, ...JOB_DEFAULTS }
    );

    res.json({ id: extraction.id, status: 'queued', message: 'Extraction re-queued for retry' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /v1/extract/test — no auth, IP rate limited, no DB storage ──────────

// In-memory store: ip -> [timestamps]
const testRateLimitMap = new Map();
const TEST_LIMIT = 10;
const TEST_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function testIpRateLimit(req, _res, next) {
  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  const now = Date.now();
  const windowStart = now - TEST_WINDOW_MS;

  let timestamps = testRateLimitMap.get(ip) ?? [];
  timestamps = timestamps.filter(t => t > windowStart);

  if (timestamps.length >= TEST_LIMIT) {
    const retryAfter = Math.ceil((timestamps[0] + TEST_WINDOW_MS - now) / 1000);
    return next(new RateLimitError(`Test endpoint rate limit: ${TEST_LIMIT} requests/hour`, retryAfter));
  }

  timestamps.push(now);
  testRateLimitMap.set(ip, timestamps);
  next();
}

testRouter.post('/', testIpRateLimit, validate(testBodySchema), async (req, res, next) => {
  try {
    const { input, image, image_url, schema: jsonSchema } = req.body;

    let inputImage = null;
    if (image) {
      inputImage = { base64: image.data, mediaType: image.media_type };
    } else if (image_url) {
      const fetched = await fetchImageAsBase64(image_url);
      inputImage = { base64: fetched.data, mediaType: fetched.media_type };
    }

    const inputText = input ?? '';

    const { data, meta } = await extract(inputText, jsonSchema, {
      inputImage,
      maxRetries: 1,
      inputType: inputImage ? 'image' : 'text',
    });

    res.json({
      result: data,
      confidence: meta.confidence,
      field_confidences: meta.fieldConfidences,
      warnings: meta.warnings,
      meta: {
        model: meta.model,
        processing_ms: meta.processingMs,
        input_tokens: meta.inputTokens,
        output_tokens: meta.outputTokens,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { testRouter };
export default router;
