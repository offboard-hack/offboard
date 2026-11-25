import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/server.ts",
        "src/vercel.ts",
        "src/worker.ts",
        "src/shared/action-dispatch.ts",
        "src/**/*.test.ts",
      ],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
