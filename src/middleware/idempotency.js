import Redis from 'ioredis';
import { config } from '../config/index.js';

const redis = new Redis(config.REDIS_URL);

redis.on('error', () => {});  // suppress unhandled-rejection on connect failure

export default async function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key) return next();

  const rKey = `idempotency:${req.workspace.id}:${key}`;

  let cached;
  try {
    cached = await redis.get(rKey);
  } catch {
    // Redis unavailable — continue without idempotency rather than failing the request
    return next();
  }

  if (cached) {
    const { statusCode, body } = JSON.parse(cached);
    res.setHeader('Idempotency-Replayed', 'true');
    return res.status(statusCode).json(body);
  }

  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 500) {
      redis
        .set(rKey, JSON.stringify({ statusCode: res.statusCode, body }), 'EX', 86400)
        .catch(() => {});
    }
    return origJson(body);
  };

  next();
}
