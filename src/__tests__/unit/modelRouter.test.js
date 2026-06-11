import { describe, it, expect } from '@jest/globals';
import { selectModel } from '../../services/modelRouter.js';

const HAIKU  = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

const SHORT_TEXT   = 'Invoice total: $150';
const LONG_TEXT    = 'x'.repeat(2001);

const SIMPLE_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' } },
};

// Schema whose JSON.stringify length exceeds 500 chars
const COMPLEX_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      `field${i}`,
      { type: 'string', description: `Detailed description for field number ${i} in the invoice schema` },
    ])
  ),
};

describe('selectModel', () => {
  it('returns haiku for short input and simple schema', () => {
    const { model } = selectModel(SHORT_TEXT, SIMPLE_SCHEMA, false);
    expect(model).toBe(HAIKU);
  });

  it('returns sonnet when input text exceeds 2000 characters', () => {
    const { model } = selectModel(LONG_TEXT, SIMPLE_SCHEMA, false);
    expect(model).toBe(SONNET);
  });

  it('returns sonnet when schema JSON serialization exceeds 500 characters', () => {
    expect(JSON.stringify(COMPLEX_SCHEMA).length).toBeGreaterThan(500);
    const { model } = selectModel(SHORT_TEXT, COMPLEX_SCHEMA, false);
    expect(model).toBe(SONNET);
  });

  it('always returns sonnet when hasImage=true, regardless of input size', () => {
    expect(selectModel(SHORT_TEXT, SIMPLE_SCHEMA, true).model).toBe(SONNET);
    expect(selectModel(LONG_TEXT,  SIMPLE_SCHEMA, true).model).toBe(SONNET);
    expect(selectModel(SHORT_TEXT, COMPLEX_SCHEMA, true).model).toBe(SONNET);
  });

  it('returns an object with model and reason string fields', () => {
    const result = selectModel(SHORT_TEXT, SIMPLE_SCHEMA, false);
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('reason');
    expect(typeof result.model).toBe('string');
    expect(typeof result.reason).toBe('string');
  });

  it('sets reason to "image_input" when hasImage=true', () => {
    expect(selectModel(SHORT_TEXT, SIMPLE_SCHEMA, true).reason).toBe('image_input');
  });

  it('sets reason to "simple_schema" for haiku path', () => {
    expect(selectModel(SHORT_TEXT, SIMPLE_SCHEMA, false).reason).toBe('simple_schema');
  });
});
