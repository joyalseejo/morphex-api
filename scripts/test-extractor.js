// Verification test for extractor.js
// Run: node scripts/test-extractor.js

// Dynamic import so config/index.js dotenv load fires before module evaluation
const { extract, selectModel } = await import('../src/services/extractor.js');

const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', X = '\x1b[0m', D = '\x1b[2m';

const INPUT = 'need 50 bags cement grade 53 calicut tuesday';
const SCHEMA = {
  type: 'object',
  properties: {
    product:      { type: 'string' },
    quantity:     { type: 'number' },
    location:     { type: 'string' },
    deliveryDate: { type: 'string', description: 'Requested delivery date or day, e.g. "tuesday", "next week"' },
  },
};

// Model router check
const { model, reason } = selectModel(INPUT, SCHEMA, false);
console.log(`\n${B}Model router${X}`);
console.log(`  input length : ${INPUT.length} chars`);
console.log(`  schema size  : ${JSON.stringify(SCHEMA).length} chars`);
console.log(`  → ${B}${model}${X}  ${D}(${reason})${X}\n`);

// Live extraction
console.log(`${B}Extraction${X}  "${INPUT}"\n`);
const start = Date.now();
const { data, meta } = await extract(INPUT, SCHEMA);
const elapsed = Date.now() - start;

// Results
console.log(`${B}data${X}`);
for (const [k, v] of Object.entries(data)) {
  const conf = meta.fieldConfidences[k];
  const confStr = conf != null ? ` ${D}(conf ${conf.toFixed(2)})${X}` : '';
  const present = v !== null ? G : R;
  console.log(`  ${present}${k}${X}: ${JSON.stringify(v)}${confStr}`);
}

console.log(`\n${B}meta${X}`);
console.log(`  model        : ${meta.model}`);
console.log(`  confidence   : ${meta.confidence}`);
console.log(`  inputTokens  : ${meta.inputTokens}`);
console.log(`  outputTokens : ${meta.outputTokens}`);
console.log(`  processingMs : ${meta.processingMs}ms  (wall: ${elapsed}ms)`);
if (meta.warnings.length) {
  console.log(`  warnings     : ${meta.warnings.join('; ')}`);
}

// Pass/fail
const REQUIRED = ['product', 'quantity', 'location', 'deliveryDate'];
const missing = REQUIRED.filter(f => !(f in data));
const allPresent = missing.length === 0;
const hasConfidences = REQUIRED.every(f => meta.fieldConfidences[f] != null);

console.log('\n' + '─'.repeat(50));
if (allPresent && hasConfidences) {
  console.log(`${G}${B}PASS${X} — all 4 fields present with per-field confidence scores`);
} else {
  if (missing.length) console.log(`${R}${B}FAIL${X} — missing fields: ${missing.join(', ')}`);
  if (!hasConfidences) console.log(`${R}${B}FAIL${X} — field_confidences missing for some fields`);
  process.exitCode = 1;
}
console.log();
