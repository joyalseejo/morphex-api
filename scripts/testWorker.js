// One-shot script: seeds a minimal workspace+schema+extraction row, enqueues a job,
// starts the worker, and waits for the extraction to reach status=completed.
// Run with: node scripts/testWorker.js

import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { config } from '../src/config/index.js';
import { startExtractionWorker, EXTRACTION_QUEUE } from '../src/workers/extractionWorker.js';
import logger from '../src/utils/logger.js';

const prisma = new PrismaClient();

async function seed() {
  const workspace = await prisma.workspace.create({
    data: { name: 'Test Workspace', slug: `test-${Date.now()}`, plan: 'free' },
  });

  const schema = await prisma.schema.create({
    data: {
      workspaceId: workspace.id,
      name: 'Test Schema',
      slug: 'test-schema',
      jsonSchema: { type: 'object', properties: { name: { type: 'string' } } },
    },
  });

  const apiKey = await prisma.apiKey.create({
    data: {
      workspaceId: workspace.id,
      name: 'test-key',
      keyHash: 'testhash',
      keyPrefix: 'mx_live_test',
    },
  });

  const extraction = await prisma.extraction.create({
    data: {
      workspaceId: workspace.id,
      schemaId: schema.id,
      apiKeyId: apiKey.id,
      inputText: 'Hello, my name is Alice.',
      status: 'queued',
    },
  });

  return { workspace, schema, extraction };
}

async function cleanup(workspaceId) {
  await prisma.workspace.delete({ where: { id: workspaceId } });
}

async function pollUntilDone(extractionId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.extraction.findUnique({ where: { id: extractionId } });
    if (row?.status === 'completed' || row?.status === 'failed') return row;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for extraction ${extractionId}`);
}

async function main() {
  logger.info('Seeding test data...');
  const { workspace, extraction } = await seed();

  const worker = startExtractionWorker();

  const queue = new Queue(EXTRACTION_QUEUE, { connection: { url: config.REDIS_URL } });

  logger.info('Enqueuing job', { extractionId: extraction.id });
  await queue.add('extract', {
    extractionId: extraction.id,
    inputText: 'Hello, my name is Alice.',
    inputImage: null,
    schema: { type: 'object', properties: { name: { type: 'string' } } },
    options: {},
    workspaceId: workspace.id,
  });

  logger.info('Waiting for worker to process job...');
  const result = await pollUntilDone(extraction.id);

  logger.info('Extraction result', {
    status: result.status,
    confidence: result.confidence,
    result: result.result,
  });

  if (result.status !== 'completed') {
    logger.error('Test FAILED — unexpected status', { status: result.status, errorMessage: result.errorMessage });
    process.exitCode = 1;
  } else {
    logger.info('Test PASSED');
  }

  await cleanup(workspace.id);
  await queue.close();
  await worker.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error('Test script error', { error: err.message });
  process.exit(1);
});
