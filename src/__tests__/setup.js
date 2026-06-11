import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();

// ─── DB helpers shared by integration test suites ─────────────────────────────

export async function createTestContext() {
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Jest Test Workspace',
      slug: `jest-${Date.now()}-${randomBytes(4).toString('hex')}`,
      plan: 'starter',
    },
  });

  const liveRaw    = 'mx_live_' + randomBytes(24).toString('hex');
  const sandboxRaw = 'mx_test_' + randomBytes(24).toString('hex');

  await prisma.apiKey.create({
    data: {
      workspaceId: workspace.id,
      name:        'Jest Live Key',
      keyHash:     createHash('sha256').update(liveRaw).digest('hex'),
      keyPrefix:   liveRaw.slice(0, 12),
      isSandbox:   false,
      isActive:    true,
    },
  });

  await prisma.apiKey.create({
    data: {
      workspaceId: workspace.id,
      name:        'Jest Sandbox Key',
      keyHash:     createHash('sha256').update(sandboxRaw).digest('hex'),
      keyPrefix:   sandboxRaw.slice(0, 12),
      isSandbox:   true,
      isActive:    true,
    },
  });

  return { workspace, liveKey: liveRaw, sandboxKey: sandboxRaw };
}

// Cascade-deletes workspace + all child rows via Prisma onDelete:Cascade
export async function cleanupTestContext(workspaceId) {
  await prisma.workspace.delete({ where: { id: workspaceId } });
  await prisma.$disconnect();
}
