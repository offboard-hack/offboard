import { createApiClient } from "@offboard/api-client";
import { authClient } from "./auth-client";

export const api = createApiClient(window.location.origin, {
  parseDate: false,
  fetch: { cache: "no-store", redirect: "error" },
});

export function signInWithCode(email: string) {
  return authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
}

export function verifyCode(email: string, otp: string) {
  return authClient.signIn.emailOtp({ email, otp });
}
