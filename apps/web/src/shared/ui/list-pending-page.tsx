import { ListBreadcrumb, ListPage } from "./list-page";

export function ListPendingPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ListPage pending title={title} breadcrumb={<ListBreadcrumb title={title} />}>
      <p role="status" className="sr-only">
        Carregando {title}…
      </p>
      <div aria-hidden="true" className="grid min-w-0 gap-5">
        {children}
      </div>
    </ListPage>
  );
}
