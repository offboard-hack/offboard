import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";
import stylesUrl from "@/styles.css?url";
import { Document, NotFoundPage, Portal } from "../portal";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: "Offboard" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/offboard-icon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "stylesheet", href: stylesUrl },
    ],
  }),
  shellComponent: Document,
  component: Portal,
  notFoundComponent: NotFoundPage,
});
