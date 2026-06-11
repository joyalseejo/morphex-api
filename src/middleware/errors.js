import * as Sentry from '@sentry/node';
import logger from '../utils/logger.js';
import { isProd } from '../config/index.js';

export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'AuthError';
    this.statusCode = 401;
  }
}

export class ValidationError extends Error {
  constructor(message = 'Validation failed', fields = []) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 422;
    this.fields = fields; // [{ field, message }]
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class RateLimitError extends Error {
  constructor(message = 'Rate limit exceeded', retryAfter = null) {
    super(message);
    this.name = 'RateLimitError';
    this.statusCode = 429;
    this.retryAfter = retryAfter;
  }
}

// 4-arg Express error handler
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) {
    Sentry.captureException(err, { extra: { path: req.path, method: req.method } });
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
  }

  const body = {
    error: {
      type: err.name || 'InternalServerError',
      message: statusCode >= 500 && isProd ? 'Internal server error' : err.message,
      ...(err.fields?.length && { fields: err.fields }),
      ...(err.retryAfter && { retryAfter: err.retryAfter }),
    },
  };

  if (!isProd) {
    body.error.stack = err.stack;
  }

  res.status(statusCode).json(body);
}
