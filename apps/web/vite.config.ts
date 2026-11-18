import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      dev: command === "serve",
      runtimeInjection: false,
    }),
    react(),
  ],
}));
