import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
  fetchOptions: { headers: { "x-offboard-audience": "staff" } },
});
