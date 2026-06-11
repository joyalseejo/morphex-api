import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import crypto from 'crypto';
import { deliverWebhook } from '../../services/webhookService.js';

// ─── Globals & helpers ────────────────────────────────────────────────────────

const TEST_URL     = 'https://example.com/webhook';
const TEST_SECRET  = 'test-signing-secret-abc123';
const TEST_PAYLOAD = { event: 'extraction.completed', extractionId: 'ext_001' };

// Build the mock prismaCtx used in tests that need DB interaction
function makePrismaCtx(overrides = {}) {
  return {
    prisma: {
      webhookDelivery: {
        count:  jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'wd_test_id_001' }),
        update: jest.fn().mockResolvedValue({}),
        ...overrides,
      },
    },
    extractionId: 'ext_001',
    workspaceId:  'ws_001',
  };
}

// Build a minimal fetch Response-like mock
function mockResponse(status, bodyText) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: jest.fn().mockResolvedValue(bodyText),
  };
}

beforeEach(() => {
  // Replace the global fetch with a fresh Jest mock before each test
  global.fetch = jest.fn();
});

// ─── 1. Successful delivery on first attempt ──────────────────────────────────

describe('deliverWebhook — success on first attempt', () => {
  it('returns { success: true, attempts: 1 }', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, '{"ok":true}'));

    const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.statusCode).toBe(200);
  });

  it('calls fetch exactly once', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
    await deliverWebhook(TEST_URL, TEST_PAYLOAD);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends POST to the correct URL', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
    await deliverWebhook(TEST_URL, TEST_PAYLOAD);
    expect(global.fetch).toHaveBeenCalledWith(TEST_URL, expect.objectContaining({ method: 'POST' }));
  });

  it('sends Content-Type: application/json header', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
    await deliverWebhook(TEST_URL, TEST_PAYLOAD);
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends X-Morphex-Event header matching payload.event', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
    await deliverWebhook(TEST_URL, TEST_PAYLOAD);
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers['X-Morphex-Event']).toBe('extraction.completed');
  });

  it('sends X-Morphex-Timestamp as a numeric epoch string', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
    await deliverWebhook(TEST_URL, TEST_PAYLOAD);
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers['X-Morphex-Timestamp']).toMatch(/^\d+$/);
  });
});

// ─── 2. HMAC signature correctness ───────────────────────────────────────────

describe('deliverWebhook — HMAC signature', () => {
  it('X-Morphex-Signature matches manually computed sha256 HMAC over JSON body', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

    await deliverWebhook(TEST_URL, TEST_PAYLOAD, TEST_SECRET);

    const [, options] = global.fetch.mock.calls[0];
    const capturedSig = options.headers['X-Morphex-Signature'];

    // The service signs JSON.stringify(payload) — replicate that here
    const expectedSig = 'sha256=' + crypto
      .createHmac('sha256', TEST_SECRET)
      .update(JSON.stringify(TEST_PAYLOAD))
      .digest('hex');

    expect(capturedSig).toBe(expectedSig);
  });

  it('includes X-Morphex-Signature when secret is provided', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
    await deliverWebhook(TEST_URL, TEST_PAYLOAD, TEST_SECRET);
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers['X-Morphex-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('omits X-Morphex-Signature when secret is null', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
    await deliverWebhook(TEST_URL, TEST_PAYLOAD, null);
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers['X-Morphex-Signature']).toBeUndefined();
  });
});

// ─── 3. Retry on 5xx — success on 3rd attempt ────────────────────────────────

describe('deliverWebhook — retry on 5xx', () => {
  it('retries twice then returns success on 3rd attempt', async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse(500, 'Server Error'))
      .mockResolvedValueOnce(mockResponse(503, 'Unavailable'))
      .mockResolvedValueOnce(mockResponse(200, '{"ok":true}'));

    const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
  }, 15000); // real sleep delays: 1000ms + 3000ms = 4s

  it('marks final DB record as success, not failed', async () => {
    global.fetch
      .mockResolvedValueOnce(mockResponse(500, 'err'))
      .mockResolvedValueOnce(mockResponse(500, 'err'))
      .mockResolvedValueOnce(mockResponse(200, 'ok'));

    const ctx = makePrismaCtx();
    await deliverWebhook(TEST_URL, TEST_PAYLOAD, null, ctx);

    const lastUpdate = ctx.prisma.webhookDelivery.update.mock.calls.at(-1)[0];
    expect(lastUpdate.data.status).toBe('success');
  }, 15000);
});

// ─── 4. All 3 attempts fail ───────────────────────────────────────────────────

describe('deliverWebhook — all attempts fail', () => {
  it('calls fetch exactly 3 times', async () => {
    global.fetch.mockResolvedValue(mockResponse(500, 'Error'));

    await deliverWebhook(TEST_URL, TEST_PAYLOAD);

    expect(global.fetch).toHaveBeenCalledTimes(3);
  }, 15000);

  it('returns { success: false } without throwing', async () => {
    global.fetch.mockResolvedValue(mockResponse(500, 'Error'));

    const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);

    expect(result.success).toBe(false);
  }, 15000);

  it('updates WebhookDelivery to status=failed on final attempt', async () => {
    global.fetch.mockResolvedValue(mockResponse(500, 'Error'));

    const ctx = makePrismaCtx();
    await deliverWebhook(TEST_URL, TEST_PAYLOAD, null, ctx);

    const lastUpdate = ctx.prisma.webhookDelivery.update.mock.calls.at(-1)[0];
    expect(lastUpdate.data.status).toBe('failed');
  }, 15000);
});

// ─── 5. Network error (fetch throws) ─────────────────────────────────────────

describe('deliverWebhook — network errors', () => {
  it('retries 3 times even when fetch throws ECONNREFUSED', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await deliverWebhook(TEST_URL, TEST_PAYLOAD);

    expect(global.fetch).toHaveBeenCalledTimes(3);
  }, 15000);

  it('returns { success: false } and does not throw on network error', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(deliverWebhook(TEST_URL, TEST_PAYLOAD)).resolves.toMatchObject({
      success: false,
    });
  }, 15000);

  it('marks DB record failed after network error exhausts retries', async () => {
    global.fetch.mockRejectedValue(new Error('ETIMEDOUT'));

    const ctx = makePrismaCtx();
    await deliverWebhook(TEST_URL, TEST_PAYLOAD, null, ctx);

    const lastUpdate = ctx.prisma.webhookDelivery.update.mock.calls.at(-1)[0];
    expect(lastUpdate.data.status).toBe('failed');
  }, 15000);
});

// ─── 6. responseBody stored on the delivery record ───────────────────────────

describe('deliverWebhook — responseBody persistence', () => {
  it('stores the HTTP response body in WebhookDelivery.update on success', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, '{"received":true}'));

    const ctx = makePrismaCtx();
    await deliverWebhook(TEST_URL, TEST_PAYLOAD, null, ctx);

    const updateCall = ctx.prisma.webhookDelivery.update.mock.calls[0][0];
    expect(updateCall.data.responseBody).toBe('{"received":true}');
  });

  it('stores the error body on a failed 4xx/5xx response', async () => {
    global.fetch.mockResolvedValue(mockResponse(400, 'Bad Request'));

    const ctx = makePrismaCtx();
    await deliverWebhook(TEST_URL, TEST_PAYLOAD, null, ctx);

    const lastUpdate = ctx.prisma.webhookDelivery.update.mock.calls.at(-1)[0];
    expect(lastUpdate.data.responseBody).toBe('Bad Request');
  }, 15000);

  it('creates a pending WebhookDelivery record BEFORE the HTTP call', async () => {
    // create should be called before fetch resolves
    let createCalledBeforeFetch = false;
    const ctx = makePrismaCtx();
    ctx.prisma.webhookDelivery.create = jest.fn().mockImplementation(async () => {
      createCalledBeforeFetch = true;
      return { id: 'wd_test_id_001' };
    });
    global.fetch.mockImplementation(async () => {
      expect(createCalledBeforeFetch).toBe(true);
      return mockResponse(200, 'ok');
    });

    await deliverWebhook(TEST_URL, TEST_PAYLOAD, null, ctx);

    expect(ctx.prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending' }) })
    );
  });
});
