import { jest } from '@jest/globals';

export const mockCreate = jest.fn();

// Returns the factory object expected by jest.unstable_mockModule
export function makeAnthropicMockModule() {
  return {
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
}

// Build a well-formed Anthropic API response containing extracted data + _meta
export function makeValidResponse(extractedData, { inputTokens = 150, outputTokens = 35 } = {}) {
  return {
    content: [{ text: JSON.stringify(extractedData) }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}
