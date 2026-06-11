export async function mockExtract(inputText, jsonSchema) {
  const props = jsonSchema?.properties ?? {};
  const mockData = {};

  for (const [field, def] of Object.entries(props)) {
    if (def.type === 'string')       mockData[field] = `test_${field}`;
    else if (def.type === 'number')  mockData[field] = 1;
    else if (def.type === 'boolean') mockData[field] = true;
    else if (def.type === 'array')   mockData[field] = [];
    else                              mockData[field] = null;
  }

  const fieldConfidences = Object.fromEntries(Object.keys(props).map(k => [k, 0.99]));

  return {
    data: mockData,
    meta: {
      confidence: 0.99,
      fieldConfidences,
      warnings: ['SANDBOX MODE — mock data, not real extraction'],
      model: 'sandbox',
      inputTokens: 0,
      outputTokens: 0,
      processingMs: 5,
    },
  };
}
