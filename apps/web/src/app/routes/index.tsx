import { createFileRoute } from "@tanstack/react-router";
import landingHtml from "@/features/landing/recolocacao/index.html?raw";

const page = landingHtml.replaceAll(
  /href="https:\/\/app\.off-board\.xyz\/(entrar|colaborador\/entrar)"/g,
  'href="/$1"',
);

export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: () => new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    },
  },
});
