import { Button } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import {
  createSortedRowModel,
  metaHelper,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { ColumnDef, RowData } from "@tanstack/react-table";
import type { AriaAttributes } from "react";
import { portalStyles as s } from "./surface.styles";
import { colors } from "./theme.stylex";

const styles = stylex.create({
  sortButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.375rem",
    minHeight: { default: "2.5rem", "@media (pointer: coarse)": "2.75rem" },
    minWidth: "1.5rem",
    padding: 0,
    borderWidth: 0,
    borderRadius: "0.125rem",
    backgroundColor: "transparent",
    color: { default: colors.muted, ":hover": colors.brand },
    fontWeight: 650,
    fontSize: "inherit",
    cursor: "pointer",
    textAlign: "left",
  },
  activeSort: { color: colors.brand },
  scrollRegion: {
    overflowX: "auto",
    borderEndStartRadius: "inherit",
    borderEndEndRadius: "inherit",
  },
});

const sortStates = {
  asc: { aria: "ascending", path: "M3 7.5 6 4.5l3 3" },
  desc: { aria: "descending", path: "m3 4.5 3 3 3-3" },
  none: { aria: undefined, path: "M3 4.5 6 1.5l3 3m-6 3 3 3 3-3" },
} satisfies {
  [Key in "asc" | "desc" | "none"]: { aria: AriaAttributes["aria-sort"]; path: string };
};

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnMeta: metaHelper<{ cellStyle?: stylex.StyleXStyles }>(),
  sortFns: {
    portugueseText: (a, b, column) =>
      collator.compare(a.getValue<string>(column), b.getValue<string>(column)),
  },
});

export type TableColumn<T extends RowData> = ColumnDef<typeof features, T>;

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
}: {
  data: T[];
  columns: TableColumn<T>[];
  labelledBy: string;
  getRowId?: (row: T) => string;
  tableStyle?: stylex.StyleXStyles;
  headStyle?: stylex.StyleXStyles;
  rowStyle?: stylex.StyleXStyles;
  cellStyle?: stylex.StyleXStyles;
  emptyText?: string;
  scrollLabel?: string;
}) {
  const table = useTable({
    features,
    columns,
    data,
    getRowId,
    defaultColumn: { enableSorting: false },
    enableMultiSort: false,
  });

  if (data.length === 0 && emptyText) {
    return <p {...stylex.props(s.panelEmpty)}>{emptyText}</p>;
  }

  const content = (
    <table {...stylex.props(s.table, tableStyle)} aria-labelledby={labelledBy}>
      <thead {...stylex.props(s.tableHead, headStyle)}>
        {table.getHeaderGroups().map(({ id, headers }) => (
          <tr key={id}>
            {headers.map((header) => {
              const { column } = header;
              const direction = column.getIsSorted();
              const sort = sortStates[direction || "none"];

              return (
                <th
                  key={header.id}
                  {...stylex.props(
                    s.cell,
                    s.tableHeading,
                    cellStyle,
                    column.columnDef.meta?.cellStyle,
                  )}
                  scope="col"
                  aria-sort={sort.aria}
                >
                  {column.getCanSort() ? (
                    <Button
                      {...stylex.props(styles.sortButton, direction && styles.activeSort)}
                      type="button"
                      onClick={column.getToggleSortingHandler()}
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
                    </Button>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} {...stylex.props(rowStyle)}>
            {row.getAllCells().map((cell, index) => {
              const props = stylex.props(s.cell, cellStyle, cell.column.columnDef.meta?.cellStyle);

              return index === 0 ? (
                <th key={cell.id} {...props} scope="row">
                  <table.FlexRender cell={cell} />
                </th>
              ) : (
                <td key={cell.id} {...props}>
                  <table.FlexRender cell={cell} />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return scrollLabel ? (
    <div
      {...stylex.props(styles.scrollRegion)}
      role="region"
      aria-label={scrollLabel}
      tabIndex={0}
      data-table-scroll
    >
      {content}
    </div>
  ) : (
    content
  );
}
