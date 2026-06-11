import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { validate } from '../../middleware/validate.js';
import { NotFoundError } from '../../middleware/errors.js';
import { generateApiKey, hashApiKey, getKeyPrefix } from '../../utils/apiKey.js';
import logger from '../../utils/logger.js';

const router = Router();
const prisma = new PrismaClient();

const createKeyBody = z.object({
  name: z.string().min(1).max(100),
  rateLimit: z.number().int().min(1).max(10_000).default(100),
  isSandbox: z.boolean().default(false),
});

const patchKeyBody = z
  .object({
    name: z.string().min(1).max(100).optional(),
    rateLimit: z.number().int().min(1).max(10_000).optional(),
  })
  .refine(d => d.name !== undefined || d.rateLimit !== undefined, {
    message: 'At least one of name or rateLimit is required',
  });

// GET /v1/keys
router.get('/', async (req, res, next) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { workspaceId: req.workspace.id },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        rateLimit: true,
        isActive: true,
        isSandbox: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: keys });
  } catch (err) {
    next(err);
  }
});

// POST /v1/keys — creates a key and returns the raw value ONCE
router.post('/', validate(createKeyBody), async (req, res, next) => {
  try {
    const { name, rateLimit, isSandbox } = req.body;
    const type = isSandbox ? 'test' : 'live';
    const rawKey = generateApiKey(type);
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = getKeyPrefix(rawKey);

    const key = await prisma.apiKey.create({
      data: {
        workspaceId: req.workspace.id,
        name,
        keyHash,
        keyPrefix,
        rateLimit,
        isSandbox,
        isActive: true,
      },
    });

    logger.info('API key created', { keyId: key.id, workspaceId: req.workspace.id, name });

    res.status(201).json({
      id: key.id,
      name: key.name,
      key: rawKey,
      prefix: keyPrefix,
      rate_limit: key.rateLimit,
      is_sandbox: key.isSandbox,
      created_at: key.createdAt,
      note: 'Store this key securely — it cannot be retrieved again',
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /v1/keys/:id — update name or rateLimit
router.patch('/:id', validate(patchKeyBody), async (req, res, next) => {
  try {
    const existing = await prisma.apiKey.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id },
    });

    if (!existing) throw new NotFoundError(`API key ${req.params.id} not found`);

    const { name, rateLimit } = req.body;
    const updated = await prisma.apiKey.update({
      where: { id: existing.id },
      data: {
        ...(name !== undefined && { name }),
        ...(rateLimit !== undefined && { rateLimit }),
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        rateLimit: true,
        isActive: true,
        isSandbox: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /v1/keys/:id/rotate — swap hash atomically; old key is immediately invalid
router.post('/:id/rotate', async (req, res, next) => {
  try {
    const existing = await prisma.apiKey.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id, isActive: true },
    });

    if (!existing) throw new NotFoundError(`API key ${req.params.id} not found`);

    const type = existing.isSandbox ? 'test' : 'live';
    const rawKey = generateApiKey(type);
    const rotatedAt = new Date();

    await prisma.apiKey.update({
      where: { id: existing.id },
      data: {
        keyHash: hashApiKey(rawKey),
        keyPrefix: getKeyPrefix(rawKey),
      },
    });

    sendKeyRotationEmail(req.workspace, existing.name).catch(() => {});

    logger.info('API key rotated', { keyId: existing.id, workspaceId: req.workspace.id });

    res.json({
      id: existing.id,
      name: existing.name,
      prefix: getKeyPrefix(rawKey),
      key: rawKey,
      rotated_at: rotatedAt.toISOString(),
      note: 'Store this key securely — it cannot be retrieved again',
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/keys/:id — revoke (soft delete via isActive flag)
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.apiKey.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id },
    });

    if (!existing) throw new NotFoundError(`API key ${req.params.id} not found`);

    await prisma.apiKey.update({
      where: { id: existing.id },
      data: { isActive: false },
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

async function sendKeyRotationEmail(workspace, keyName) {
  logger.info('Key rotation email (stubbed — wire mailer to activate)', {
    to: workspace.email ?? '(no email on workspace)',
    message: `Your API key "${keyName}" was rotated. Update your integrations.`,
  });
}

export default router;
