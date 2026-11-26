import { notifySessionChange } from "@/shared/lib/session-change";
import { CodeSignIn } from "@/shared/ui/code-sign-in";
import { employeeAuth, requestEmployeeCode } from "./auth";

async function verifyEmployeeCode(email: string, otp: string) {
  try {
    const { error } = await employeeAuth.signIn.emailOtp({ email, otp });

    if (!error) return undefined;

    return error.status === 429
      ? "Muitas tentativas. Aguarde antes de tentar novamente."
      : "Código inválido ou expirado. Confira ou solicite outro.";
  } catch {
    return "Não foi possível entrar. Tente novamente.";
  }
}

export function EmployeeLogin() {
  return (
    <CodeSignIn
      idPrefix="employee"
      requestCode={requestEmployeeCode}
      verifyCode={verifyEmployeeCode}
      onSignedIn={() => {
        notifySessionChange();
        window.location.assign("/colaborador");
      }}
    />
  );
}
