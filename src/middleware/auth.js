import * as Sentry from '@sentry/node';
import { PrismaClient } from '@prisma/client';
import { getKeyPrefix, verifyApiKey } from '../utils/apiKey.js';
import { AuthError } from './errors.js';

const prisma = new PrismaClient();

export async function authenticate(req, _res, next) {
  try {
    const rawKey = req.headers['x-api-key'];

    if (!rawKey) {
      throw new AuthError('Missing x-api-key header');
    }

    const prefix = getKeyPrefix(rawKey);

    const apiKey = await prisma.apiKey.findFirst({
      where: { keyPrefix: prefix, isActive: true },
      include: { workspace: true },
    });

    if (!apiKey) {
      throw new AuthError('Invalid API key');
    }

    if (!verifyApiKey(rawKey, apiKey.keyHash)) {
      throw new AuthError('Invalid API key');
    }

    // Non-blocking stamp — don't await so auth doesn't add latency
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    Sentry.setTag('workspace_id', apiKey.workspace.id);

    req.workspace = apiKey.workspace;
    req.apiKey = apiKey;
    req.isSandbox = apiKey.isSandbox;

    next();
  } catch (err) {
    next(err);
  }
}
