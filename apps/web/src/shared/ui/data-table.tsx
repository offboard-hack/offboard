import { defaultListPageSize, listPageSizes } from "@/shared/lib/list-search";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/shared/ui/shadcn/pagination";
import type { ComponentProps, ReactNode } from "react";
import { PortalFilter } from "./select";
import { classProps } from "../lib/class-props";
import { Button } from "@/shared/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/shadcn/dropdown-menu";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/shared/ui/shadcn/table";
import { Empty, EmptyDescription } from "@/shared/ui/shadcn/empty";
import {
  createSortedRowModel,
  functionalUpdate,
  columnVisibilityFeature,
  createPaginatedRowModel,
  rowPaginationFeature,
  metaHelper,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { ColumnDef, PaginationState, RowData } from "@tanstack/react-table";
import type { AriaAttributes } from "react";
import { portalStyles as s } from "./surface.styles";

const styles = {
  scrollRegion: "overflow-x-auto focus-visible:outline-offset-[-2px]",
};

const sortStates = {
  asc: { aria: "ascending", path: "M3 7.5 6 4.5l3 3" },
  desc: { aria: "descending", path: "m3 4.5 3 3 3-3" },
  none: { aria: undefined, path: "M3 4.5 6 1.5l3 3m-6 3 3 3 3-3" },
} satisfies {
  [Key in "asc" | "desc" | "none"]: { aria: AriaAttributes["aria-sort"]; path: string };
};

const pageSizes = listPageSizes.map((size) => ({ value: String(size), label: String(size) }));

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

const features = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  columnMeta: metaHelper<{ cellStyle?: string }>(),
  sortFns: {
    portugueseText: (a, b, column) =>
      collator.compare(a.getValue<string>(column), b.getValue<string>(column)),
  },
});

export type TableColumn<T extends RowData> = ColumnDef<typeof features, T> & { header: string };

export function DataTable<T extends RowData>({
  data,
  columns,
  labelledBy,
  getRowId,
  tableStyle,
  headStyle,
  rowStyle,
  cellStyle,
  emptyText,
  scrollLabel,
  scrollClassName,
  toolbar,
  onRowClick,
  appearance = "panel",
  urlPagination,
  filters,
  toolbarEnd,
}: {
  data: T[];
  columns: TableColumn<T>[];
  labelledBy: string;
  getRowId?: (row: T) => string;
  tableStyle?: string;
  headStyle?: string;
  rowStyle?: string;
  cellStyle?: string;
  emptyText?: string;
  scrollLabel?: string;
  scrollClassName?: string;
  toolbar?: ReactNode;
  appearance?: "panel" | "embedded";
  urlPagination?: PaginationState & {
    onChange: (next: PaginationState) => void;
  };
  filters?: (ComponentProps<typeof PortalFilter> & { caption: string })[];
  toolbarEnd?: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  const panel = appearance === "panel";
  const pageSize = urlPagination?.pageSize ?? defaultListPageSize;
  const lastPageIndex = Math.max(0, Math.ceil(data.length / pageSize) - 1);

  const pagination = {
    pageIndex: Math.min(urlPagination?.pageIndex ?? 0, lastPageIndex),
    pageSize,
  };

  const table = useTable({
    features,
    columns,
    data,
    getRowId,
    defaultColumn: { enableSorting: false },
    enableMultiSort: false,
    initialState: { pagination: { pageSize: panel ? defaultListPageSize : 25, pageIndex: 0 } },
    ...(urlPagination && {
      state: { pagination },
      onPaginationChange: (update) => urlPagination.onChange(functionalUpdate(update, pagination)),
      autoResetPageIndex: false,
    }),
  });

  const containerProps = scrollLabel
    ? {
        ...classProps(styles.scrollRegion, scrollClassName),
        role: "region",
        "aria-label": scrollLabel,
        tabIndex: 0,
      }
    : undefined;

  return (
    <div className={panel ? "min-w-0 overflow-hidden rounded-2xl border bg-card" : "min-w-0"}>
      {filters && filters.length > 0 && (
        <div className="grid gap-3 border-b px-3 py-4 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] sm:gap-5 sm:px-5">
          {filters.map(({ caption, ...filter }) => (
            <div key={filter.label} className="grid min-w-0 gap-1.5">
              <span className="text-sm font-medium">{caption}</span>
              <PortalFilter {...filter} className="!h-9 min-h-0 w-full" />
            </div>
          ))}
        </div>
      )}
      {(toolbar || toolbarEnd) && (
        <div
          className={
            panel
              ? "flex flex-wrap items-center gap-2 border-b p-3 sm:px-5 sm:py-4"
              : "flex flex-wrap items-center gap-2 pb-3"
          }
        >
          {toolbar}
          {toolbarEnd}
        </div>
      )}
      {data.length === 0 && emptyText ? (
        <Empty>
          <EmptyDescription>{emptyText}</EmptyDescription>
        </Empty>
      ) : (
        <Table
          {...classProps(panel && "text-xs sm:text-sm", tableStyle)}
          aria-labelledby={labelledBy}
          containerProps={containerProps}
        >
          <TableHeader {...classProps(s.tableHead, panel && "bg-muted/45", headStyle)}>
            {table.getHeaderGroups().map(({ id, headers }) => (
              <TableRow key={id}>
                {headers.map((header) => {
                  const { column } = header;
                  const direction = column.getIsSorted();
                  const sort = sortStates[direction || "none"];

                  return (
                    <TableHead
                      key={header.id}
                      {...classProps(
                        panel && "px-2.5 py-2 sm:px-3",
                        cellStyle,
                        column.columnDef.meta?.cellStyle,
                      )}
                      scope="col"
                      aria-sort={sort.aria}
                    >
                      {column.getCanSort() ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-0 text-xs font-medium text-inherit"
                              />
                            }
                          >
                            <table.FlexRender header={header} />
                            <svg
                              aria-hidden="true"
                              focusable="false"
                              width="12"
                              height="12"
                              viewBox="0 0 12 12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.25"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d={sort.path} />
                            </svg>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
                              Crescente
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
                              Decrescente
                            </DropdownMenuItem>
                            {direction && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => column.clearSorting()}>
                                  Limpar ordenação
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                {...classProps(
                  panel && "border-primary/10",
                  rowStyle,
                  onRowClick && "cursor-pointer focus-within:bg-primary/5 hover:bg-primary/5",
                )}
                onClick={
                  onRowClick &&
                  ((event) => {
                    if (
                      event.target instanceof Element &&
                      !event.target.closest("a,button,[role=button]") &&
                      !window.getSelection()?.toString()
                    ) {
                      onRowClick(row.original);
                    }
                  })
                }
              >
                {row.getVisibleCells().map((cell, index) => {
                  const props = classProps(
                    "p-2 text-left align-middle",
                    panel && "px-2.5 py-2 sm:px-3",
                    cellStyle,
                    cell.column.columnDef.meta?.cellStyle,
                  );

                  return index === 0 ? (
                    <th key={cell.id} {...props} scope="row">
                      <table.FlexRender cell={cell} />
                    </th>
                  ) : (
                    <TableCell key={cell.id} {...props}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {(table.getPageCount() > 1 || panel) && (
        <div
          className={
            panel
              ? "flex flex-wrap items-center justify-end gap-2 border-t px-3 py-3 sm:px-5"
              : "flex flex-wrap items-center justify-end gap-2 py-3"
          }
        >
          {panel && (
            <span className="mr-auto text-sm text-muted-foreground">
              {data.length
                ? `${table.state.pagination.pageIndex * table.state.pagination.pageSize + 1}–${Math.min((table.state.pagination.pageIndex + 1) * table.state.pagination.pageSize, data.length)} de ${data.length} registros`
                : "0 registros"}
            </span>
          )}
          {panel && (
            <div className="flex items-center gap-2">
              <span className="hidden text-sm text-muted-foreground md:inline">Por página</span>
              <PortalFilter
                label="Registros por página"
                className="min-h-8"
                value={String(table.state.pagination.pageSize)}
                items={pageSizes}
                onChange={(value) => {
                  table.setPagination({ pageIndex: 0, pageSize: Number(value) });
                }}
              />
            </div>
          )}
          <Pagination className="mx-0 w-auto shrink-0">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={!table.getCanPreviousPage()}
                  onClick={() => table.previousPage()}
                />
              </PaginationItem>
              <PaginationItem
                className="px-1 text-sm text-muted-foreground tabular-nums"
                aria-live="polite"
              >
                {table.getPageCount() > 0
                  ? `Página ${table.state.pagination.pageIndex + 1} de ${table.getPageCount()}`
                  : "Sem páginas"}
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  disabled={!table.getCanNextPage()}
                  onClick={() => table.nextPage()}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
