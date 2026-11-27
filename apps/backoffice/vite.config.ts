import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/backoffice/",
  plugins: [react()],
  server: { proxy: { "/api": process.env.API_URL ?? "http://localhost:3001" } },
  build: { outDir: "../web/public/backoffice", emptyOutDir: true },
});
