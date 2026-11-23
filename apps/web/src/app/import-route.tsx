import { Link } from "@tanstack/react-router";
import { ImportPage } from "@/features/bulk-import/import-page";
import { classProps } from "@/shared/lib/class-props";
import { portalStyles as s } from "@/shared/ui/surface.styles";

export function BulkImport() {
  return (
    <ImportPage
      returnLink={
        <Link to="/desligamentos" {...classProps(s.backLink)}>
          Voltar para desligamentos
        </Link>
      }
    />
  );
}
