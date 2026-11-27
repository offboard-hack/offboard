import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const employeeAuth = createAuthClient({
  plugins: [emailOTPClient()],
  fetchOptions: { headers: { "x-offboard-audience": "employee" } },
});

export async function requestEmployeeCode(email: string) {
  const { error } = await employeeAuth.emailOtp.sendVerificationOtp({ email, type: "sign-in" });

  if (error) {
    throw new Error(
      error.status === 429
        ? "Muitas tentativas. Aguarde um momento antes de pedir outro código."
        : "Não foi possível enviar o código. Tente novamente.",
    );
  }
}
