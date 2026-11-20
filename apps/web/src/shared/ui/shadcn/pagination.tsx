import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

import { Button } from "./button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

function Pagination({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="Paginação"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}

function PaginationContent({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}

function PaginationItem({ ...props }: ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

function PaginationPrevious(props: ComponentProps<typeof Button>) {
  return (
    <Button type="button" variant="outline" size="sm" aria-label="Página anterior" {...props}>
      <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden="true" data-icon="inline-start" />
      <span className="hidden sm:inline">Anterior</span>
    </Button>
  );
}

function PaginationNext(props: ComponentProps<typeof Button>) {
  return (
    <Button type="button" variant="outline" size="sm" aria-label="Próxima página" {...props}>
      <span className="hidden sm:inline">Próxima</span>
      <HugeiconsIcon icon={ArrowRight01Icon} aria-hidden="true" data-icon="inline-end" />
    </Button>
  );
}

export { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious };
