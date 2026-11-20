import { createFileRoute } from "@tanstack/react-router";
import { BulkImport } from "../portal";

export const Route = createFileRoute("/desligamentos_/importar")({
  head: () => ({ meta: [{ title: "Cadastro em massa · Offboard" }] }),
  component: BulkImport,
});
