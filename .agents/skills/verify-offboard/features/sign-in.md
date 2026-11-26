# Entrar no portal

Invited members sign in with a six-digit code sent by email and return to the protected page they requested.

## Driving it with Playwright

Use a fresh context and an invited email address. Codes are stored hashed, so capture the email with a development mailbox or a local stub behind `RESEND_BASE_URL`.

1. Open `/desligamentos` without a session. Confirm the portal sends you to `/entrar` with `voltar=/desligamentos`.
2. Wait for **Enviar código** to become enabled. Fill **E-mail** and submit. Confirm the page moves to **Código de acesso** with the email locked.
3. Type the received code and choose **Entrar**. Confirm the portal returns to `/desligamentos` and displays the case list.
4. Save the authenticated storage state outside the checkout if another driver needs it. Keep the code and session cookies out of evidence.
