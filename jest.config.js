/** @type {import('jest').Config} */
// API tests: the backend (src/server) served over a real HTTP socket, against a throwaway MongoDB.
module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  testRegex: "test/.*\\.e2e-spec\\.ts$",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "test/tsconfig.json" }] },
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  globalSetup: "<rootDir>/test/global-setup.mjs",
  globalTeardown: "<rootDir>/test/global-teardown.mjs",
  setupFiles: ["<rootDir>/test/setup-env.ts"],
  testTimeout: 30000,
};
