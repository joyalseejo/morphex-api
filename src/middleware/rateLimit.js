import Redis from 'ioredis';
import { config } from '../config/index.js';
import { RateLimitError } from './errors.js';

const redis = new Redis(config.REDIS_URL);
redis.on('error', () => {});

const WINDOW_MS = 60 * 1000;
const WINDOW_SECS = 60;

// Requests per minute by workspace plan
const PLAN_LIMITS = {
  free:       100,
  starter:    1000,
  growth:     5000,
  enterprise: 10000,
};

export async function rateLimit(req, res, next) {
  try {
    const keyId = req.apiKey?.id ?? req.ip;
    const plan  = req.workspace?.plan ?? 'free';
    const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

    // Align to current 1-minute window bucket
    const windowStart = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
    const rKey   = `ratelimit:${keyId}:${windowStart}`;
    const resetAt = Math.ceil((windowStart + WINDOW_MS) / 1000);  // epoch seconds

    let count;
    try {
      const pipe = redis.pipeline();
      pipe.incr(rKey);
      pipe.expire(rKey, WINDOW_SECS + 5);  // +5s buffer so the key outlives the window
      const results = await pipe.exec();
      const [incrErr, incrCount] = results[0];
      if (incrErr) throw incrErr;
      count = incrCount;
    } catch {
      // Redis unavailable — fail open so an outage doesn't block all requests
      return next();
    }

    const remaining = Math.max(0, limit - count);

    res.setHeader('X-RateLimit-Limit',     limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset',     resetAt);

    if (count > limit) {
      return next(new RateLimitError(
        `Rate limit of ${limit} req/min exceeded (${plan} plan)`,
        resetAt
      ));
    }

    next();
  } catch (err) {
    next(err);
  }
}
