import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "offboard-landing",
    compatibilityDate: "2026-11-23",
    domains: ["off-board.xyz"],
    workersDev: false,
    assets: { notFoundHandling: "none" },
  },
});
