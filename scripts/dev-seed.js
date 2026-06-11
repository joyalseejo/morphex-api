import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { generateApiKey, hashApiKey, getKeyPrefix } from '../src/utils/apiKey.js';

loadDotenv();

const prisma = new PrismaClient();

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Never run dev seed in production');
    process.exit(1);
  }

  const workspace = await prisma.workspace.upsert({
    where: { slug: 'dev-workspace' },
    update: {},
    create: {
      name: 'Dev Workspace',
      slug: 'dev-workspace',
      email: 'dev@morphex.dev',
      plan: 'growth',
      webhookSecret: crypto.randomBytes(32).toString('hex'),
    },
  });

  const liveKey = generateApiKey('live');
  const testKey = generateApiKey('test');

  await prisma.apiKey.create({
    data: {
      workspaceId: workspace.id,
      name: 'Dev Live Key',
      keyHash: hashApiKey(liveKey),
      keyPrefix: getKeyPrefix(liveKey),
    },
  });

  await prisma.apiKey.create({
    data: {
      workspaceId: workspace.id,
      name: 'Dev Test Key',
      keyHash: hashApiKey(testKey),
      keyPrefix: getKeyPrefix(testKey),
      isSandbox: true,
    },
  });

  console.log('\n=== DEV SEED COMPLETE ===');
  console.log('Live key:', liveKey);
  console.log('Test key:', testKey);
  console.log('Workspace ID:', workspace.id);
}

seed().catch(console.error).finally(() => prisma.$disconnect());
