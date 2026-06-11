import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { config, isDev } from './config/index.js';
import logger from './utils/logger.js';
import v1Router from './routes/index.js';
import { errorHandler, NotFoundError } from './middleware/errors.js';

// ─── Request timeout middleware ───────────────────────────────────────────────
// Fires a 503 if the handler hasn't sent headers within the window.
// The sync extract path (Sonnet) can legitimately take ~20–25s; 30s is the ceiling.
function requestTimeout(ms) {
  return (_req, res, next) => {
    const id = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({
          error: { type: 'TimeoutError', message: 'Request timed out — try again or use async mode' },
        });
      }
    }, ms);
    res.on('finish', () => clearTimeout(id));
    res.on('close',  () => clearTimeout(id));
    next();
  };
}

const app = express();

// Security & transport middleware
app.use(helmet());
app.use(
  cors({
    origin: config.FRONTEND_URL,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization', 'Idempotency-Key'],
    credentials: true,
  })
);
app.use(compression());
app.use(requestTimeout(30_000));
// Payloads above 10 MB are rejected by the body parser with a 413
app.use(express.json({ limit: '10mb' }));

// HTTP request logging — only to logger stream so it respects JSON format in prod
app.use(
  morgan(isDev ? 'dev' : 'combined', {
    stream: { write: (msg) => logger.http(msg.trimEnd()) },
  })
);

// Health check — no auth required
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: process.env.npm_package_version ?? '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.use('/v1', v1Router);

// 404 for anything unmatched
app.use((req, res, next) => {
  next(new NotFoundError(`${req.method} ${req.path} not found`));
});

// 4-arg error handler must be last
app.use(errorHandler);

export default app;
