import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ─── Mock @anthropic-ai/sdk BEFORE any module that imports it ─────────────────
// jest.unstable_mockModule + top-level await is the ESM pattern for module mocks.
const mockCreate = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// Dynamic import — must come AFTER unstable_mockModule so the mock is in place
const { extract } = await import('../../services/extractor.js');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SCHEMA = {
  type: 'object',
  properties: {
    product:  { type: 'string' },
    quantity: { type: 'number' },
  },
};

function apiResponse(payload, { inputTokens = 150, outputTokens = 35 } = {}) {
  return {
    content: [{ text: JSON.stringify(payload) }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

const VALID_PAYLOAD = {
  product:  'cement',
  quantity: 50,
  _meta: {
    confidence:        0.95,
    field_confidences: { product: 0.99, quantity: 0.91 },
    warnings:          [],
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('extract()', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns { data, meta } structure', async () => {
    mockCreate.mockResolvedValueOnce(apiResponse(VALID_PAYLOAD));
    const result = await extract('50 bags of cement', SCHEMA);
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('meta');
  });

  it('strips _meta from data — _meta is never in the returned data object', async () => {
    mockCreate.mockResolvedValueOnce(apiResponse(VALID_PAYLOAD));
    const { data } = await extract('50 bags of cement', SCHEMA);
    expect(data._meta).toBeUndefined();
    expect(data.product).toBe('cement');
    expect(data.quantity).toBe(50);
  });

  it('meta contains confidence, fieldConfidences, warnings, model, inputTokens, outputTokens, processingMs', async () => {
    mockCreate.mockResolvedValueOnce(apiResponse(VALID_PAYLOAD, { inputTokens: 120, outputTokens: 40 }));
    const { meta } = await extract('50 bags of cement', SCHEMA);

    expect(typeof meta.confidence).toBe('number');
    expect(meta.confidence).toBeGreaterThanOrEqual(0);
    expect(meta.confidence).toBeLessThanOrEqual(1);
    expect(meta.confidence).toBe(0.95);

    expect(typeof meta.fieldConfidences).toBe('object');
    expect(meta.fieldConfidences.product).toBe(0.99);

    expect(Array.isArray(meta.warnings)).toBe(true);

    expect(typeof meta.model).toBe('string');
    expect(meta.inputTokens).toBe(120);
    expect(meta.outputTokens).toBe(40);
    expect(typeof meta.processingMs).toBe('number');
  });

  it('retries when model returns JSON wrapped in markdown fences', async () => {
    // First call: model wraps response in ```json ... ``` — invalid JSON
    mockCreate.mockResolvedValueOnce({
      content: [{ text: '```json\n' + JSON.stringify(VALID_PAYLOAD) + '\n```' }],
      usage: { input_tokens: 150, output_tokens: 40 },
    });
    // Second call (after corrective prompt): valid bare JSON
    mockCreate.mockResolvedValueOnce(apiResponse(VALID_PAYLOAD));

    const { data } = await extract('50 bags of cement', SCHEMA, { maxRetries: 2 });
    expect(data.product).toBe('cement');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('retries when model returns non-JSON prose', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'Sure, here is the extracted data: the product is cement and quantity is 50.' }],
      usage: { input_tokens: 100, output_tokens: 25 },
    });
    mockCreate.mockResolvedValueOnce(apiResponse(VALID_PAYLOAD));

    const { data } = await extract('50 bags of cement', SCHEMA, { maxRetries: 2 });
    expect(data.product).toBe('cement');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after maxRetries attempts if model never returns valid JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ text: 'I cannot extract that.' }],
      usage: { input_tokens: 80, output_tokens: 10 },
    });

    await expect(
      extract('test input', SCHEMA, { maxRetries: 1 })
    ).rejects.toThrow('Extraction failed: model did not return valid JSON after 2 attempt(s)');

    // maxRetries:1 means 1 initial attempt + 1 retry = 2 total calls
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('accumulates tokens across retry attempts', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'not json' }],
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    mockCreate.mockResolvedValueOnce(apiResponse(VALID_PAYLOAD, { inputTokens: 120, outputTokens: 30 }));

    const { meta } = await extract('test', SCHEMA, { maxRetries: 2 });
    expect(meta.inputTokens).toBe(220);   // 100 + 120
    expect(meta.outputTokens).toBe(40);   // 10 + 30
  });

  it('defaults missing schema fields to null and adds a contract warning', async () => {
    // Model returns only product, omits quantity
    mockCreate.mockResolvedValueOnce(apiResponse({
      product: 'steel',
      _meta: { confidence: 0.8, field_confidences: { product: 0.9 }, warnings: [] },
    }));

    const { data, meta } = await extract('steel rods', SCHEMA);
    expect(data.quantity).toBeNull();
    expect(meta.warnings.some(w => w.includes('"quantity"'))).toBe(true);
  });
});
