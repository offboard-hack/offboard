# Entrar no portal

Invited members sign in with a one-time link and return to the protected page they requested.

## Driving it with Playwright

Use a fresh context and an invited email address. Use a development mailbox or a local email capture configured for the disposable instance.

1. Open `/desligamentos` without a session. Confirm the portal sends you to `/entrar` with `voltar=/desligamentos`.
2. Wait for **Enviar link de acesso** to become enabled. Fill **E-mail** and submit. Check the confirmation message.
3. Follow the received link in the same context. Confirm the portal returns to `/desligamentos` and displays the case list.
4. Save the authenticated storage state outside the checkout if another driver needs it. Keep the email link and session cookies out of evidence.
