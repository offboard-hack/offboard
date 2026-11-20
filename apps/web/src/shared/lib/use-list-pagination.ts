import { useSearch } from "@tanstack/react-router";
import type { PaginationState } from "@tanstack/react-table";
import { defaultListPageSize, listPageSizes } from "./list-search";

type PageSize = (typeof listPageSizes)[number];

type PaginationSearch = {
  page?: number;
  pageSize?: PageSize;
  teamPage?: number;
  teamPageSize?: PageSize;
};

export function useListPagination(
  updateSearch: (patch: PaginationSearch) => void,
  scope: "list" | "team" = "list",
) {
  const search = useSearch({ strict: false });

  return {
    pageIndex: ((scope === "team" ? search.teamPage : search.page) ?? 1) - 1,
    pageSize: (scope === "team" ? search.teamPageSize : search.pageSize) ?? defaultListPageSize,
    onChange(next: PaginationState) {
      const page = next.pageIndex > 0 ? next.pageIndex + 1 : undefined;

      const pageSize = listPageSizes.find(
        (size) => size === next.pageSize && size !== defaultListPageSize,
      );

      updateSearch(
        scope === "team" ? { teamPage: page, teamPageSize: pageSize } : { page, pageSize },
      );
    },
  };
}
