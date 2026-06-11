import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request                                         from 'supertest';
import app                                             from '../../app.js';
import { createTestContext, cleanupTestContext }       from '../setup.js';

let ctx;
let createdSchemaId;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await cleanupTestContext(ctx.workspace.id);
});

const VALID_SCHEMA_BODY = {
  name:       'Test Product Schema',
  slug:       'test-product',
  jsonSchema: {
    type: 'object',
    properties: {
      name:     { type: 'string' },
      price:    { type: 'number' },
      quantity: { type: 'number' },
    },
  },
};

// ─── GET /v1/schemas ──────────────────────────────────────────────────────────

describe('GET /v1/schemas', () => {
  it('returns system schemas (seeded in dev DB)', async () => {
    const res = await request(app)
      .get('/v1/schemas')
      .set('x-api-key', ctx.liveKey);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('count');

    const systemSchemas = res.body.data.filter(s => s.isSystem);
    expect(systemSchemas.length).toBe(7);
  });

  it('schema objects include expected fields', async () => {
    const res = await request(app)
      .get('/v1/schemas')
      .set('x-api-key', ctx.liveKey);

    const first = res.body.data[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('slug');
    expect(first).toHaveProperty('isSystem');
    expect(first).toHaveProperty('version');
  });
});

// ─── GET /v1/schemas/:idOrSlug ────────────────────────────────────────────────

describe('GET /v1/schemas/invoice-v1', () => {
  it('returns the full invoice system schema by slug', async () => {
    const res = await request(app)
      .get('/v1/schemas/invoice-v1')
      .set('x-api-key', ctx.liveKey);

    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('invoice-v1');
    expect(res.body.isSystem).toBe(true);
    expect(res.body).toHaveProperty('jsonSchema');
    expect(res.body.jsonSchema).toHaveProperty('properties');
  });

  it('returns 404 for a slug that does not exist', async () => {
    const res = await request(app)
      .get('/v1/schemas/does-not-exist-ever')
      .set('x-api-key', ctx.liveKey);

    expect(res.status).toBe(404);
    expect(res.body.error.type).toBe('NotFoundError');
  });
});

// ─── POST /v1/schemas ─────────────────────────────────────────────────────────

describe('POST /v1/schemas', () => {
  it('creates a custom schema and returns 201 with the new record', async () => {
    const res = await request(app)
      .post('/v1/schemas')
      .set('x-api-key', ctx.liveKey)
      .send(VALID_SCHEMA_BODY);

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('test-product');
    expect(res.body.isSystem).toBe(false);
    expect(res.body.version).toBe(1);
    expect(res.body.isLatest).toBe(true);
    expect(res.body).toHaveProperty('id');

    createdSchemaId = res.body.id;
  });

  it('returns 422 when slug already exists in the workspace', async () => {
    const res = await request(app)
      .post('/v1/schemas')
      .set('x-api-key', ctx.liveKey)
      .send(VALID_SCHEMA_BODY);   // same slug as above

    expect(res.status).toBe(422);
    expect(res.body.error.type).toBe('ValidationError');
  });

  it('returns 422 when jsonSchema is missing required properties field', async () => {
    const res = await request(app)
      .post('/v1/schemas')
      .set('x-api-key', ctx.liveKey)
      .send({ name: 'Bad Schema', jsonSchema: { type: 'string' } });

    expect(res.status).toBe(422);
  });
});

// ─── DELETE /v1/schemas/:id ───────────────────────────────────────────────────

describe('DELETE /v1/schemas/:id', () => {
  it('returns 404 when attempting to delete a system schema (not workspace-owned)', async () => {
    // Find a system schema id
    const listRes = await request(app)
      .get('/v1/schemas?isSystem=true')
      .set('x-api-key', ctx.liveKey);

    const systemSchemaId = listRes.body.data[0].id;

    // DELETE treats system schemas as "not found" for this workspace (isSystem:false filter)
    const res = await request(app)
      .delete(`/v1/schemas/${systemSchemaId}`)
      .set('x-api-key', ctx.liveKey);

    expect(res.status).toBe(404);
  });

  it('deletes a workspace-owned schema and returns 204', async () => {
    expect(createdSchemaId).toBeDefined();

    const res = await request(app)
      .delete(`/v1/schemas/${createdSchemaId}`)
      .set('x-api-key', ctx.liveKey);

    expect(res.status).toBe(204);
  });
});
