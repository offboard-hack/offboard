import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/features/checklist/action-config.ts",
        "src/features/billing/plan-view.ts",
        "src/app/spending-tabs.ts",
        "src/entities/benefits-summary.ts",
        "src/features/benefits/policy-form.ts",
        "src/features/asset-returns/equipment-form.ts",
        "src/features/integrations/slack-settings.ts",
        "src/features/asset-returns/equipment-csv.ts",
        "src/entities/career/failure.ts",
        "src/entities/career/refresh.ts",
        "src/features/employee/career/jobs-view.ts",
        "src/features/employee/career/labels.ts",
        "src/features/employee/career/ai-apply-form.ts",
        "src/features/employee/career/benefit-features.ts",
        "src/features/employee/career/plan-card.ts",
        "src/features/employee/career/preferences-form.ts",
        "src/features/employee/career/job-preferences-form.ts",
        "src/features/employee/career/rejections.ts",
        "src/features/employee/career/diversity-form.ts",
        "src/features/employee/career/resume-onboarding.ts",
      ],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
