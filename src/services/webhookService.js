import crypto from 'crypto';
import logger from '../utils/logger.js';

const RETRY_DELAYS_MS = [1000, 3000, 9000];

/**
 * Deliver a webhook with up to 3 attempts.
 *
 * When prismaCtx is supplied, each attempt is logged as a WebhookDelivery record.
 * Omit prismaCtx for test/no-DB paths (e.g. the test extract endpoint).
 *
 * @param {string}  url
 * @param {object}  payload
 * @param {string|null} secret   HMAC signing secret
 * @param {{ prisma, extractionId, workspaceId }=} prismaCtx
 */
export async function deliverWebhook(url, payload, secret = null, prismaCtx = null) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(payload);
  const headers = buildHeaders(body, payload, timestamp, secret);

  // Determine the next attempt number if prior records exist
  let baseAttemptNumber = 1;
  if (prismaCtx) {
    const prior = await prismaCtx.prisma.webhookDelivery.count({
      where: { extractionId: prismaCtx.extractionId },
    });
    baseAttemptNumber = prior + 1;
  }

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const attemptNumber = baseAttemptNumber + attempt;

    // Create a pending delivery record before the HTTP call
    let deliveryId = null;
    if (prismaCtx) {
      const record = await prismaCtx.prisma.webhookDelivery.create({
        data: {
          id:            generateId(),
          extractionId:  prismaCtx.extractionId,
          workspaceId:   prismaCtx.workspaceId,
          url,
          payload,
          status:        'pending',
          attemptNumber,
        },
      });
      deliveryId = record.id;
    }

    let httpStatus = null;
    let responseBody = null;
    let succeeded = false;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });

      httpStatus = res.status;
      responseBody = await res.text().catch(() => null);

      if (res.ok) {
        logger.info('Webhook delivered', {
          url, event: payload.event, status: httpStatus, attempt: attemptNumber,
        });
        succeeded = true;
      } else {
        logger.warn('Webhook non-2xx response', {
          url, event: payload.event, status: httpStatus, attempt: attemptNumber,
        });
      }
    } catch (err) {
      logger.warn('Webhook attempt failed', {
        url, event: payload.event, error: err.message, attempt: attemptNumber,
      });
    }

    // Persist the outcome
    if (prismaCtx && deliveryId) {
      await prismaCtx.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status:      succeeded ? 'success' : (attempt < RETRY_DELAYS_MS.length - 1 ? 'pending' : 'failed'),
          httpStatus,
          responseBody,
          deliveredAt: succeeded ? new Date() : null,
        },
      });
    }

    if (succeeded) {
      return { success: true, statusCode: httpStatus, attempts: attemptNumber };
    }

    if (attempt < RETRY_DELAYS_MS.length - 1) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  logger.error('Webhook delivery failed after all attempts', { url, event: payload.event });
  return { success: false, attempts: baseAttemptNumber + RETRY_DELAYS_MS.length - 1 };
}

function buildHeaders(body, payload, timestamp, secret) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Morphex-Event': payload.event ?? 'extraction.completed',
    'X-Morphex-Timestamp': timestamp,
  };

  if (secret) {
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    headers['X-Morphex-Signature'] = `sha256=${sig}`;
  }

  return headers;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateId() {
  return `wd_${crypto.randomBytes(10).toString('hex')}`;
}
