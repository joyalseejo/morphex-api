import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../middleware/errors.js';
import { deliverWebhook } from '../../services/webhookService.js';

const router = Router();
const prisma = new PrismaClient();

// ─── GET /v1/webhooks/deliveries ──────────────────────────────────────────────

router.get('/deliveries', async (req, res, next) => {
  try {
    const limit       = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
    const extractionId = req.query.extractionId ?? null;
    const status       = req.query.status ?? null;

    const where = {
      workspaceId: req.workspace.id,
      ...(extractionId && { extractionId }),
      ...(status && { status }),
    };

    const deliveries = await prisma.webhookDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id:           true,
        extractionId: true,
        url:          true,
        status:       true,
        httpStatus:   true,
        responseBody: true,
        attemptNumber: true,
        deliveredAt:  true,
        createdAt:    true,
      },
    });

    res.json({ data: deliveries, count: deliveries.length });
  } catch (err) {
    next(err);
  }
});

// ─── POST /v1/webhooks/deliveries/:id/retry ───────────────────────────────────

router.post('/deliveries/:id/retry', async (req, res, next) => {
  try {
    const delivery = await prisma.webhookDelivery.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id },
      include: { extraction: { include: { workspace: true } } },
    });

    if (!delivery) throw new NotFoundError(`Webhook delivery ${req.params.id} not found`);

    // Fire a fresh delivery attempt (logged as a new WebhookDelivery record)
    const result = await deliverWebhook(
      delivery.url,
      delivery.payload,
      delivery.extraction.workspace.webhookSecret ?? null,
      {
        prisma,
        extractionId: delivery.extractionId,
        workspaceId:  delivery.workspaceId,
      }
    );

    // Sync the parent extraction's webhookStatus to match outcome
    await prisma.extraction.update({
      where: { id: delivery.extractionId },
      data: { webhookStatus: result.success ? 'delivered' : 'failed' },
    });

    res.json({
      success:  result.success,
      attempts: result.attempts,
      message:  result.success ? 'Webhook delivered successfully' : 'Webhook delivery failed',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
