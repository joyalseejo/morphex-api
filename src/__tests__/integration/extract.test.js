import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';

// ─── Mock Anthropic BEFORE app import so the live extract path never hits the API
const mockCreate = jest.fn();
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

const { default: app }              = await import('../../app.js');
const { createTestContext, cleanupTestContext } = await import('../setup.js');
const { default: request }          = await import('supertest');
const { PrismaClient }              = await import('@prisma/client');

const prisma = new PrismaClient();

const SIMPLE_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' } },
};

// Anthropic response the mock returns on any live (non-sandbox) call
const MOCK_API_RESPONSE = {
  content: [{
    text: JSON.stringify({
      name: 'John Smith',
      _meta: { confidence: 0.97, field_confidences: { name: 0.97 }, warnings: [] },
    }),
  }],
  usage: { input_tokens: 100, output_tokens: 20 },
};

let ctx;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await cleanupTestContext(ctx.workspace.id);
  await prisma.$disconnect();
});

// ─── Authentication ────────────────────────────────────────────────────────────

describe('POST /v1/extract — authentication', () => {
  it('returns 401 AuthError when x-api-key header is absent', async () => {
    const res = await request(app)
      .post('/v1/extract')
      .send({ input: 'test', schema: SIMPLE_SCHEMA });

    expect(res.status).toBe(401);
    expect(res.body.error.type).toBe('AuthError');
  });

  it('returns 401 AuthError when x-api-key is invalid', async () => {
    const res = await request(app)
      .post('/v1/extract')
      .set('x-api-key', 'mx_live_notarealkey0000000000000000000')
      .send({ input: 'test', schema: SIMPLE_SCHEMA });

    expect(res.status).toBe(401);
    expect(res.body.error.type).toBe('AuthError');
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('POST /v1/extract — request validation', () => {
  it('returns 422 ValidationError when both schema and schema_id are missing', async () => {
    const res = await request(app)
      .post('/v1/extract')
      .set('x-api-key', ctx.sandboxKey)
      .send({ input: 'test input' });

    expect(res.status).toBe(422);
    expect(res.body.error.type).toBe('ValidationError');
  });

  it('returns 422 ValidationError when neither input nor image is provided', async () => {
    const res = await request(app)
      .post('/v1/extract')
      .set('x-api-key', ctx.sandboxKey)
      .send({ schema: SIMPLE_SCHEMA });

    expect(res.status).toBe(422);
    expect(res.body.error.type).toBe('ValidationError');
  });
});

// ─── Sandbox sync extraction (no real Anthropic call) ─────────────────────────

describe('POST /v1/extract — sandbox mode', () => {
  it('returns 200 with completed extraction result', async () => {
    const res = await request(app)
      .post('/v1/extract')
      .set('x-api-key', ctx.sandboxKey)
      .send({ input: 'John Smith', schema: SIMPLE_SCHEMA });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('result');
    expect(res.body.meta).toHaveProperty('model');
    expect(res.body.meta.sandbox).toBe(true);
  });

  it('stores extraction record in DB after successful sandbox sync', async () => {
    const res = await request(app)
      .post('/v1/extract')
      .set('x-api-key', ctx.sandboxKey)
      .send({ input: 'Jane Doe', schema: SIMPLE_SCHEMA });

    expect(res.status).toBe(200);

    const stored = await prisma.extraction.findUnique({ where: { id: res.body.id } });
    expect(stored).not.toBeNull();
    expect(stored.status).toBe('completed');
    expect(stored.isSandbox).toBe(true);
  });
});

// ─── Live sync extraction (mocked Anthropic) ──────────────────────────────────

describe('POST /v1/extract — live sync (mocked Anthropic)', () => {
  it('returns 200 with extraction result using mocked model response', async () => {
    mockCreate.mockResolvedValueOnce(MOCK_API_RESPONSE);

    const res = await request(app)
      .post('/v1/extract')
      .set('x-api-key', ctx.liveKey)
      .send({ input: 'John Smith', schema: SIMPLE_SCHEMA });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.result.name).toBe('John Smith');
    expect(res.body.meta.model).toMatch(/claude/);
  });

  it('response includes confidence, field_confidences, warnings, and meta', async () => {
    mockCreate.mockResolvedValueOnce(MOCK_API_RESPONSE);

    const res = await request(app)
      .post('/v1/extract')
      .set('x-api-key', ctx.liveKey)
      .send({ input: 'John Smith', schema: SIMPLE_SCHEMA });

    expect(res.status).toBe(200);
    expect(typeof res.body.confidence).toBe('number');
    expect(typeof res.body.field_confidences).toBe('object');
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.meta).toMatchObject({
      model:        expect.any(String),
      processing_ms: expect.any(Number),
      input_tokens:  expect.any(Number),
      output_tokens: expect.any(Number),
    });
  });
});

// ─── POST /v1/extract/test — unauthenticated endpoint ─────────────────────────

describe('POST /v1/extract/test', () => {
  it('returns 200 without an x-api-key (mocked Anthropic)', async () => {
    mockCreate.mockResolvedValueOnce(MOCK_API_RESPONSE);

    const res = await request(app)
      .post('/v1/extract/test')
      .send({ input: 'John Smith', schema: SIMPLE_SCHEMA });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('result');
    expect(res.body.result.name).toBe('John Smith');
  });
});
