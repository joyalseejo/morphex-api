module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFiles: ['<rootDir>/src/__tests__/env.cjs'],
  // Unit tests are fast; integration tests hit real DB + Redis — allow 30s
  testTimeout: 30000,
  // Automatically call jest.clearAllMocks() before every test
  clearMocks: true,
  transform: {},
  // Redis / Prisma connections from app.js stay open — force exit after suite
  forceExit: true,
};
