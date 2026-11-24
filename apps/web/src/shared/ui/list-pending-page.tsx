import { ListBreadcrumb, ListPage } from "./list-page";

export function ListPendingPage({
  title,
  breadcrumb = <ListBreadcrumb title={title} />,
  children,
}: {
  title: string;
  breadcrumb?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <ListPage pending title={title} breadcrumb={breadcrumb}>
      <p role="status" className="sr-only">
        Carregando {title}…
      </p>
      <div aria-hidden="true" className="grid min-w-0 gap-5">
        {children}
      </div>
    </ListPage>
  );
}
