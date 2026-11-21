import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({
      router: {
        entry: "app/router.tsx",
        routesDirectory: "app/routes",
        generatedRouteTree: "app/routeTree.gen.ts",
      },
    }),
    react(),
  ],
  server: { proxy: { "/api": process.env.API_URL ?? "http://localhost:3001" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
