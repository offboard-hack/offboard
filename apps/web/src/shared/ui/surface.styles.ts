import { buttonVariants } from "./shadcn/button";

export const portalStyles = {
  pageHeader: "mb-6 flex flex-wrap items-end justify-between gap-4",
  heading: "text-2xl font-semibold tracking-tight sm:text-3xl",
  subheading: "text-base font-semibold",
  workHeading: "text-lg font-semibold",
  workSurface: "min-w-0",
  description: "mt-2 text-sm text-muted-foreground",
  button: "min-h-11",
  secondaryButton: buttonVariants({ variant: "outline" }),
  backLinkRow: "mb-3",
  backLink: "inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline",
  panel: "min-w-0",
  panelHeader: "flex items-center justify-between gap-3 border-b py-3",
  panelEmpty: "py-4 text-sm text-muted-foreground",
  tableHead: "bg-muted text-xs text-muted-foreground",
  filterInput: "min-h-11 min-w-0 basis-64",
  tableHeading: "font-medium",
};
