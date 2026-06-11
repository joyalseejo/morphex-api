export function selectModel(inputText, schema, hasImage = false) {
  if (hasImage) return { model: 'claude-sonnet-4-6', reason: 'image_input' };

  const schemaComplexity = JSON.stringify(schema).length;
  const inputLength = (inputText || '').length;

  if (schemaComplexity > 500 || inputLength > 2000)
    return { model: 'claude-sonnet-4-6', reason: 'complex_schema' };

  return { model: 'claude-haiku-4-5-20251001', reason: 'simple_schema' };
}
