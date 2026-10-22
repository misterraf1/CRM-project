/** @type {import('jest').Config} */
module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  testRegex: "test/.*\\.e2e-spec\\.ts$",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  globalSetup: "<rootDir>/test/global-setup.mjs",
  globalTeardown: "<rootDir>/test/global-teardown.mjs",
  setupFiles: ["<rootDir>/test/setup-env.ts"],
  testTimeout: 30000,
};
