import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

import { requirePortalAccess } from "../portal-access";

export const Route = createFileRoute("/_portal/desligamentos_/importar")({
  beforeLoad: ({ context }) => requirePortalAccess(context.principal, "create", "Offboarding"),
  head: () => ({ meta: [{ title: "Cadastro em massa · Offboard" }] }),
  component: lazyRouteComponent(() => import("../import-route"), "BulkImport"),
});
