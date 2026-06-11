// Loads .env into process.env before any ESM module is evaluated.
// Must be CJS so it runs regardless of "type":"module" in package.json.
require('dotenv').config();
