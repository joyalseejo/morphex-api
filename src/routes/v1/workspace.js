import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

// GET /v1/workspace/webhook-secret
// Returns the current HMAC secret developers use to verify incoming Morphex webhooks.
router.get('/webhook-secret', (req, res) => {
  res.json({ secret: req.workspace.webhookSecret ?? null });
});

// POST /v1/workspace/webhook-secret/rotate
// Generates a new secret. Any webhook consumer using the old secret will need to update.
router.post('/webhook-secret/rotate', async (req, res, next) => {
  try {
    const secret = crypto.randomBytes(32).toString('hex');

    await prisma.workspace.update({
      where: { id: req.workspace.id },
      data: { webhookSecret: secret },
    });

    res.json({
      secret,
      rotatedAt: new Date().toISOString(),
      note: 'Update your webhook consumer to use this new secret immediately.',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
