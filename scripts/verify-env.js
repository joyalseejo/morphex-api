import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';

loadDotenv();

const G = '\x1b[32m';  // green
const R = '\x1b[31m';  // red
const Y = '\x1b[33m';  // yellow
const D = '\x1b[2m';   // dim
const X = '\x1b[0m';   // reset
const B = '\x1b[1m';   // bold

async function checkDatabase() {
  const prisma = new PrismaClient();
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'fail', latencyMs: Date.now() - start, note: err.message.split('\n')[0] };
  } finally {
    await prisma.$disconnect();
  }
}

async function checkRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return { status: 'fail', note: 'REDIS_URL not set' };

  const redis = new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 5000 });
  const start = Date.now();
  try {
    await redis.connect();
    const pong = await redis.ping();
    return { status: pong === 'PONG' ? 'ok' : 'fail', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'fail', latencyMs: Date.now() - start, note: err.message };
  } finally {
    redis.disconnect();
  }
}

function checkAnthropicKey() {
  const key = process.env.ANTHROPIC_API_KEY ?? '';
  if (key.startsWith('sk-ant-')) return { status: 'ok', note: 'format OK' };
  return { status: 'fail', note: 'must start with sk-ant-' };
}

function checkStripeKey() {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (key.startsWith('sk_')) return { status: 'ok', note: 'format OK' };
  return { status: 'fail', note: 'must start with sk_' };
}

function fmt(result) {
  const icon  = result.status === 'ok' ? `${G}✓ OK${X}` : `${R}✗ FAIL${X}`;
  const lat   = result.latencyMs != null ? `${result.latencyMs}ms` : `${D}–${X}`;
  const note  = result.note ?? '';
  return { icon, lat, note };
}

function row(name, result) {
  const { icon, lat, note } = fmt(result);
  const pad = (s, n) => s.padEnd(n);
  return `  ${pad(name, 14)} ${pad(icon + X, 18)} ${pad(lat, 10)} ${note}`;
}

async function main() {
  console.log(`\n${B}Morphex — environment verification${X}\n`);

  const [db, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const anthropic   = checkAnthropicKey();
  const stripe      = checkStripeKey();

  const checks = { Database: db, Redis: redis, Anthropic: anthropic, Stripe: stripe };

  console.log(`  ${'Service'.padEnd(14)} ${'Status'.padEnd(10)} ${'Latency'.padEnd(10)} Note`);
  console.log('  ' + '─'.repeat(56));

  for (const [name, result] of Object.entries(checks)) {
    console.log(row(name, result));
  }

  console.log();

  const failed = Object.values(checks).filter(c => c.status !== 'ok');
  if (failed.length === 0) {
    console.log(`${G}${B}All checks passed.${X}\n`);
    process.exit(0);
  } else {
    console.log(`${R}${B}${failed.length} check(s) failed.${X}\n`);
    process.exit(1);
  }
}

main();
