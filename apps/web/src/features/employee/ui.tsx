import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { consentRequiredMessage } from "@/entities/employee";
import { Card, CardContent, CardDescription, CardHeader } from "@/shared/ui/shadcn/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/shared/ui/shadcn/empty";

export function EmployeePanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

export function EmployeeError({ message, id }: { message?: string; id?: string }) {
  return message ? (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
      {message === consentRequiredMessage && (
        <>
          {" "}
          <Link
            to="/colaborador"
            search={{ tela: "privacidade" }}
            className="font-medium underline underline-offset-4"
          >
            Abrir termos e privacidade
          </Link>
        </>
      )}
    </p>
  ) : null;
}

export function EmployeeEmpty({ children }: { children: ReactNode }) {
  return (
    <Empty className="border p-6">
      <EmptyHeader>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
