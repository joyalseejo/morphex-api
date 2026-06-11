import * as Sentry from '@sentry/node';
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { config, isProd } from './config/index.js';
import logger from './utils/logger.js';
import app from './app.js';
import { startExtractionWorker } from './workers/extractionWorker.js';

const prisma = new PrismaClient();

// Initialize Sentry whenever a DSN is provided (dev gets traces disabled to avoid noise)
if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    tracesSampleRate: isProd ? 0.2 : 0.0,
  });
  logger.info('Sentry initialized', { env: config.NODE_ENV });
}

const server = app.listen(config.PORT, () => {
  logger.info(`Morphex API running on port ${config.PORT}`, {
    env: config.NODE_ENV,
    port: config.PORT,
  });
});

// Start the BullMQ worker in the same process for simplicity.
// In production at scale, move this to a dedicated worker process.
const worker = startExtractionWorker();

// ─── Monthly usage-reset cron ─────────────────────────────────────────────────
// Fires at 00:00 on the 1st of every month.
// UsageRecords are already date-partitioned so no rows need deleting;
// this job just logs the rollover so the ops team can see it in the dashboard.
cron.schedule('0 0 1 * *', async () => {
  try {
    const workspaces = await prisma.workspace.findMany({ select: { id: true } });
    logger.info('Monthly usage rollover', { workspaceCount: workspaces.length });
  } catch (err) {
    logger.error('Monthly usage cron failed', { error: err.message });
  }
});

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);

  server.close(async () => {
    logger.info('HTTP server closed');
    await worker.close();
    logger.info('Worker closed');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('Shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — exiting', { error: err.message, stack: err.stack });
  process.exit(1);
});
