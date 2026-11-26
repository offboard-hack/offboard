import type { ReactNode } from "react";
import { notifySessionChange } from "@/shared/lib/session-change";
import { CodeSignIn } from "@/shared/ui/code-sign-in";
import { authClient } from "./auth-client";
import { safeReturnPath } from "./return-path";
import { SignInLayout } from "./sign-in-layout";

async function requestMemberCode(email: string) {
  const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });

  if (error) {
    throw new Error(
      error.status === 429
        ? "Muitas tentativas. Aguarde um momento antes de pedir outro código."
        : "Não foi possível enviar o código. Tente novamente.",
    );
  }
}

async function verifyMemberCode(email: string, otp: string) {
  try {
    const { error } = await authClient.signIn.emailOtp({ email, otp });

    if (!error) return undefined;

    return error.status === 429
      ? "Muitas tentativas. Aguarde antes de tentar novamente."
      : "Código inválido ou expirado. Confira ou solicite outro.";
  } catch {
    return "Não foi possível entrar. Tente novamente.";
  }
}

export function SignInPage({
  returnPath,
  revoked,
  invalidLink,
  employeeLink,
}: {
  returnPath?: string;
  revoked: boolean;
  invalidLink: boolean;
  employeeLink?: ReactNode;
}) {
  return (
    <SignInLayout
      title="Entrar no portal"
      description="Informe seu e-mail cadastrado para receber um código de acesso."
      secondaryLink={employeeLink}
    >
      <CodeSignIn
        idPrefix="member"
        notice={
          revoked
            ? "Seu acesso foi removido. Fale com a pessoa responsável pelo portal."
            : invalidLink
              ? "Este link é inválido ou expirou. Peça um código para entrar."
              : undefined
        }
        requestCode={requestMemberCode}
        verifyCode={verifyMemberCode}
        onSignedIn={() => {
          notifySessionChange();
          window.location.assign(safeReturnPath(returnPath));
        }}
      />
    </SignInLayout>
  );
}
