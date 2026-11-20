import { Link } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./shadcn/breadcrumb";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils";
import { Card, CardHeader } from "./shadcn/card";

const tones = {
  primary: { icon: "bg-primary/10 text-primary", gradient: "from-primary/18 via-primary/4" },
  danger: {
    icon: "bg-destructive/10 text-destructive",
    gradient: "from-destructive/16 via-destructive/4",
  },
  warning: {
    icon: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
    gradient: "from-amber-400/22 via-amber-400/5",
  },
  success: {
    icon: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
    gradient: "from-emerald-400/20 via-emerald-400/5",
  },
};

export type ListMetric = {
  label: string;
  value: number | string;
  icon: ComponentProps<typeof HugeiconsIcon>["icon"];
  tone: keyof typeof tones;
};

export function ListPage({
  title,
  breadcrumb,
  metrics,
  children,
}: {
  title: string;
  breadcrumb?: ReactNode;
  metrics?: ListMetric[];
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[100rem] gap-5 px-3 py-4 sm:px-6 sm:py-6">
      <h1 id="titulo-pagina" tabIndex={-1} className="sr-only">
        {title}
      </h1>
      {breadcrumb}
      {metrics && metrics.length > 0 && (
        <div
          role="group"
          aria-label={`Resumo: ${title}`}
          className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5"
        >
          {metrics.map(({ label, value, icon, tone }) => (
            <Card
              key={label}
              size="sm"
              className={cn("bg-radial-[ellipse_at_92%_7%] to-transparent", tones[tone].gradient)}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <dl className="min-w-0">
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
                  </dl>
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg",
                      tones[tone].icon,
                    )}
                  >
                    <HugeiconsIcon icon={icon} aria-hidden="true" className="size-4" />
                  </span>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

export function ListBreadcrumb({ title }: { title: string }) {
  return (
    <Breadcrumb aria-label="Localização">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link to="/painel" />}>Painel</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
