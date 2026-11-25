import type { ReactNode } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useHydrated } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { SignInLayout } from "./sign-in-layout";
import { Button } from "@/shared/ui/shadcn/button";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import { Spinner } from "@/shared/ui/shadcn/spinner";

function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

const signUpSchema = z.object({
  orgName: z.string().trim().min(1, "Informe o nome da organização."),
  slug: z
    .string()
    .min(1, "Informe um identificador.")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use apenas letras minúsculas, números e hífens."),
  adminName: z.string().trim().min(1, "Informe seu nome."),
  adminEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Informe um e-mail válido." })),
});

type SignUpState = "idle" | "created" | "slug-taken" | "email-in-use" | "error";

const messages: Record<Exclude<SignUpState, "idle" | "created">, string> = {
  "slug-taken": "Este identificador já está em uso. Escolha outro.",
  "email-in-use": "Este e-mail já está cadastrado.",
  error: "Não foi possível criar a organização. Tente novamente.",
};

export function SignUpPage({ signInLink }: { signInLink?: ReactNode }) {
  const hydrated = useHydrated();
  const [state, setState] = useState<SignUpState>("idle");
  const [slugEdited, setSlugEdited] = useState(false);

  const form = useForm({
    defaultValues: { orgName: "", slug: "", adminName: "", adminEmail: "" },
    validators: { onSubmit: signUpSchema },
    onSubmit: async ({ value }) => {
      setState("idle");
      const data = signUpSchema.parse(value);

      try {
        const response = await fetch("/api/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        });

        if (response.status === 201) {
          setState("created");

          return;
        }

        if (response.status === 409) {
          const body: { code?: string } = await response.json();
          setState(body.code === "slug-taken" ? "slug-taken" : "email-in-use");

          return;
        }

        setState("error");
      } catch {
        setState("error");
      }
    },
  });

  if (state === "created") {
    return (
      <SignInLayout
        title="Organização criada!"
        description="Acesse o portal com o e-mail que você informou."
        secondaryLink={signInLink}
      >
        <Link to="/entrar">
          <Button className="h-12 w-full">Entrar no portal</Button>
        </Link>
      </SignInLayout>
    );
  }

  const fields = [
    { name: "orgName", label: "Nome da organização", type: "text", autoComplete: "organization" },
    { name: "slug", label: "Identificador", type: "text", autoComplete: "off" },
    { name: "adminName", label: "Seu nome", type: "text", autoComplete: "name" },
    { name: "adminEmail", label: "Seu e-mail", type: "email", autoComplete: "email" },
  ] as const;

  return (
    <SignInLayout
      title="Criar organização"
      description="Cadastre sua empresa e comece a gerenciar desligamentos."
      secondaryLink={signInLink}
    >
      <form
        method="post"
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        {fields.map(({ name, label, type, autoComplete }) => (
          <form.Field key={name} name={name}>
            {(field) => {
              const error = field.state.meta.errors[0]?.message;

              return (
                <div className="grid gap-2">
                  <Label htmlFor={name}>{label}</Label>
                  <Input
                    id={name}
                    name={name}
                    type={type}
                    autoComplete={autoComplete}
                    autoCapitalize="none"
                    spellCheck={false}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      field.handleChange(value);

                      if (name === "slug") setSlugEdited(true);

                      if (name === "orgName" && !slugEdited)
                        form.setFieldValue("slug", slugify(value));
                    }}
                    aria-invalid={!!error}
                    aria-describedby={error ? `${name}-error` : undefined}
                    className="h-12 px-4 text-base sm:text-sm"
                    required
                  />
                  {error && (
                    <p id={`${name}-error`} role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                </div>
              );
            }}
          </form.Field>
        ))}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(pending) => (
            <Button
              type="submit"
              disabled={!hydrated || pending}
              className="h-12 motion-reduce:transition-none"
            >
              {pending && <Spinner aria-hidden="true" />}
              {pending ? "Criando…" : "Criar organização"}
            </Button>
          )}
        </form.Subscribe>
        {state !== "idle" && (
          <p role="alert" className="text-sm text-destructive">
            {messages[state]}
          </p>
        )}
      </form>
    </SignInLayout>
  );
}
