import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/app.ts", "src/routes/**"],
      thresholds: { 100: true },
    },
  },
});
