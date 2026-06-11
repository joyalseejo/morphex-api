import { Worker, Queue } from 'bullmq';
import * as Sentry from '@sentry/node';
import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';
import { extract } from '../services/extractor.js';
import { deliverWebhook } from '../services/webhookService.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

export const EXTRACTION_QUEUE = 'extractions';
const DLQ_QUEUE = 'extractions-failed';

// BullMQ job defaults applied to every async extraction
export const JOB_DEFAULTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },  // 2s → 4s → 8s
};

export function startExtractionWorker() {
  // Dead-letter queue — receives jobs after all 3 attempts are exhausted
  const dlq = new Queue(DLQ_QUEUE, { connection: { url: config.REDIS_URL } });

  const worker = new Worker(
    EXTRACTION_QUEUE,
    async (job) => {
      const { extractionId, inputText, inputImage, schema, options, deprecationWarning } = job.data;

      logger.info('Processing extraction job', {
        extractionId,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
      });

      await prisma.extraction.update({
        where: { id: extractionId },
        data: { status: 'processing' },
      });

      let data, meta;
      try {
        ({ data, meta } = await extract(inputText, schema, {
          model: options?.model,
          inputImage,
          maxRetries: options?.maxRetries ?? 2,
          inputType: inputImage ? 'image' : 'text',
        }));
      } catch (err) {
        const maxAttempts = job.opts.attempts ?? JOB_DEFAULTS.attempts;
        const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;

        if (isLastAttempt) {
          // Mark DB record failed and fire failure webhook
          await prisma.extraction.update({
            where: { id: extractionId },
            data: { status: 'failed', errorMessage: err.message },
          });

          Sentry.captureException(err, {
            extra: { extractionId, attempt: job.attemptsMade + 1 },
          });

          const failed = await prisma.extraction.findUnique({
            where: { id: extractionId },
            include: { workspace: true },
          });
          if (failed?.webhookUrl) {
            await deliverWebhook(
              failed.webhookUrl,
              { event: 'extraction.failed', extractionId, error: err.message },
              failed.workspace.webhookSecret ?? null,
              { prisma, extractionId, workspaceId: failed.workspaceId }
            );
          }
        } else {
          logger.warn('Extraction attempt failed — will retry', {
            extractionId,
            attempt: job.attemptsMade + 1,
            of: maxAttempts,
            error: err.message,
          });
        }

        throw err;  // BullMQ handles retry / final-failure scheduling
      }

      const warnings = [
        ...(deprecationWarning ? [deprecationWarning] : []),
        ...(meta.warnings ?? []),
      ];

      const completed = await prisma.extraction.update({
        where: { id: extractionId },
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
        include: { workspace: true },
      });

      logger.info('Extraction completed', {
        extractionId,
        model: meta.model,
        confidence: meta.confidence,
        processingMs: meta.processingMs,
      });

      if (completed.webhookUrl) {
        const webhookResult = await deliverWebhook(
          completed.webhookUrl,
          { event: 'extraction.completed', extractionId, result: data, confidence: meta.confidence },
          completed.workspace?.webhookSecret ?? null,
          { prisma, extractionId, workspaceId: completed.workspaceId }
        );

        await prisma.extraction.update({
          where: { id: extractionId },
          data: { webhookStatus: webhookResult.success ? 'delivered' : 'failed' },
        });
      }

      return { data, meta };
    },
    {
      connection: { url: config.REDIS_URL },
      concurrency: 3,
    }
  );

  worker.on('ready', () => {
    logger.info('Worker ready', { queue: EXTRACTION_QUEUE });
  });

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? JOB_DEFAULTS.attempts;
    const isFinalFailure = job.attemptsMade >= maxAttempts;

    logger.error('Extraction job failed', {
      jobId: job.id,
      attempts: job.attemptsMade,
      final: isFinalFailure,
      error: err.message,
    });

    if (isFinalFailure) {
      await dlq.add(
        'dead-letter',
        { ...job.data, failureReason: err.message, originalJobId: job.id },
        { removeOnComplete: false, removeOnFail: false }
      ).catch((e) => logger.error('Failed to add to DLQ', { error: e.message }));

      logger.info('Extraction moved to DLQ', {
        extractionId: job.data.extractionId,
        queue: DLQ_QUEUE,
      });
    }
  });

  return worker;
}
