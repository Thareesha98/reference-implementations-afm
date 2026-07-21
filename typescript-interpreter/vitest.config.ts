import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The engine core is pure logic, so a plain (Node-like) test env is enough.
    include: ["packages/**/*.test.ts"],
  },
});
