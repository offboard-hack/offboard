import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/recolocacao")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(null, {
          status: 308,
          headers: { Location: `/${new URL(request.url).search}` },
        }),
    },
  },
});
