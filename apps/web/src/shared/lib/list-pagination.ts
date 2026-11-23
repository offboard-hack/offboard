import type { PaginationState } from "@tanstack/react-table";
import type { z } from "zod";
import { defaultListPageSize, listPageSizes, type listSearchSchema } from "./list-search";

type PaginationSearch = z.output<typeof listSearchSchema>;

export function listPagination(
  search: PaginationSearch,
  updateSearch: (patch: PaginationSearch) => void,
) {
  return {
    pageIndex: (search.page ?? 1) - 1,
    pageSize: search.pageSize ?? defaultListPageSize,
    onChange(next: PaginationState) {
      const page = next.pageIndex > 0 ? next.pageIndex + 1 : undefined;

      const pageSize = listPageSizes.find(
        (size) => size === next.pageSize && size !== defaultListPageSize,
      );

      updateSearch({ page, pageSize });
    },
  };
}
