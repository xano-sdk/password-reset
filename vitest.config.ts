import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Resets process-wide state after every test. Vitest isolates per FILE, so
    // a leak inside one file makes test order load-bearing and nothing says so.
    setupFiles: ["test/setup.ts"],
  },
});
