import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request                                         from 'supertest';
import app                                             from '../../app.js';
import { createTestContext, cleanupTestContext }       from '../setup.js';

let ctx;
let createdKeyId;
let createdKeyValue;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await cleanupTestContext(ctx.workspace.id);
});

// ─── GET /v1/keys ─────────────────────────────────────────────────────────────

describe('GET /v1/keys', () => {
  it('returns the list of API keys for the workspace', async () => {
    const res = await request(app)
      .get('/v1/keys')
      .set('x-api-key', ctx.liveKey);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    // The test workspace was set up with two keys (live + sandbox)
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('key list items do NOT include the raw keyHash', async () => {
    const res = await request(app)
      .get('/v1/keys')
      .set('x-api-key', ctx.liveKey);

    for (const key of res.body.data) {
      expect(key).not.toHaveProperty('keyHash');
    }
  });
});

// ─── POST /v1/keys ────────────────────────────────────────────────────────────

describe('POST /v1/keys', () => {
  it('creates a live key and returns 201 with the raw key value', async () => {
    const res = await request(app)
      .post('/v1/keys')
      .set('x-api-key', ctx.liveKey)
      .send({ name: 'Integration Test Key', isSandbox: false });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('key');
    expect(res.body.key).toMatch(/^mx_live_/);
    expect(res.body.is_sandbox).toBe(false);
    expect(res.body.note).toMatch(/cannot be retrieved again/);

    createdKeyId    = res.body.id;
    createdKeyValue = res.body.key;
  });

  it('creates a sandbox key with mx_test_ prefix', async () => {
    const res = await request(app)
      .post('/v1/keys')
      .set('x-api-key', ctx.liveKey)
      .send({ name: 'Sandbox Key', isSandbox: true });

    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^mx_test_/);
    expect(res.body.is_sandbox).toBe(true);
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/v1/keys')
      .set('x-api-key', ctx.liveKey)
      .send({ isSandbox: false });

    expect(res.status).toBe(422);
  });

  it('the newly created key authenticates successfully', async () => {
    expect(createdKeyValue).toBeDefined();

    const res = await request(app)
      .get('/v1/keys')
      .set('x-api-key', createdKeyValue);

    expect(res.status).toBe(200);
  });
});

// ─── PATCH /v1/keys/:id ───────────────────────────────────────────────────────

describe('PATCH /v1/keys/:id', () => {
  it('updates the key name and returns the updated record', async () => {
    expect(createdKeyId).toBeDefined();

    const res = await request(app)
      .patch(`/v1/keys/${createdKeyId}`)
      .set('x-api-key', ctx.liveKey)
      .send({ name: 'Renamed Key' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed Key');
    expect(res.body.id).toBe(createdKeyId);
  });

  it('returns 422 when patch body is empty', async () => {
    const res = await request(app)
      .patch(`/v1/keys/${createdKeyId}`)
      .set('x-api-key', ctx.liveKey)
      .send({});

    expect(res.status).toBe(422);
  });

  it('returns 404 for a key that does not belong to this workspace', async () => {
    const res = await request(app)
      .patch('/v1/keys/nonexistent-key-id-00000')
      .set('x-api-key', ctx.liveKey)
      .send({ name: 'Hacked' });

    expect(res.status).toBe(404);
  });
});

// ─── DELETE /v1/keys/:id ──────────────────────────────────────────────────────

describe('DELETE /v1/keys/:id', () => {
  it('revokes the key and returns 204', async () => {
    expect(createdKeyId).toBeDefined();

    const res = await request(app)
      .delete(`/v1/keys/${createdKeyId}`)
      .set('x-api-key', ctx.liveKey);

    expect(res.status).toBe(204);
  });

  it('revoked key returns 401 on subsequent requests', async () => {
    const res = await request(app)
      .get('/v1/keys')
      .set('x-api-key', createdKeyValue);

    expect(res.status).toBe(401);
  });
});
