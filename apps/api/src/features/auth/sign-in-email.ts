export const signInLinkMinutes = 10;

export function signInEmail({ email, url }: { email: string; url: string }) {
  const subject = "Seu link de acesso ao Offboard";
  const title = "Seu link para entrar";
  const request = "Recebemos um pedido para entrar no Offboard com este e-mail.";
  const expires = `O link expira em ${signInLinkMinutes} minutos e só pode ser usado uma vez.`;
  const retry = "Se expirar, volte à tela de login e peça outro.";
  const ignore = "Se você não tentou entrar, pode ignorar este e-mail.";

  const href = url.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const logo = new URL("/apple-touch-icon.png", url).href;

  return {
    to: email,
    subject,
    text: `${title}\n\n${request}\n\n${url}\n\n${expires} ${retry}\n\n${ignore}`,
    html: `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${subject}</title>
    <style>
      @media screen and (max-width: 480px) {
        .outer { padding: 20px 12px !important; }
        .hero { padding: 26px 24px 32px !important; }
        .heading { font-size: 32px !important; line-height: 36px !important; }
        .content { padding: 28px 24px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f2fc;font-family:Arial,Helvetica,sans-serif;color:#201733;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${expires}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f2fc" style="width:100%;">
      <tr>
        <td class="outer" align="center" style="padding:48px 16px;">
          <!--[if mso]><table role="presentation" width="552" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:552px;">
            <tr>
              <td class="hero" bgcolor="#2e1458" style="padding:32px 40px 40px;border-radius:20px 20px 0 0;background-color:#2e1458;background-image:radial-gradient(ellipse at 95% 0%,#6d24c5 0%,#2e1458 70%);color:#ffffff;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td valign="middle"><img src="${logo}" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px;"></td>
                    <td valign="middle" style="padding-left:10px;font-size:20px;line-height:24px;font-weight:700;letter-spacing:-0.4px;color:#ffffff;">Offboard</td>
                  </tr>
                </table>
                <h1 class="heading" style="margin:28px 0 0;font-size:40px;line-height:44px;letter-spacing:-1.4px;font-weight:700;color:#ffffff;">${title}</h1>
              </td>
            </tr>
            <tr>
              <td class="content" bgcolor="#ffffff" style="padding:32px 40px 36px;border:1px solid #e7dff1;border-top:0;border-radius:0 0 20px 20px;background-color:#ffffff;">
                <p style="margin:0 0 24px;font-size:16px;line-height:25px;color:#3b304c;">${request}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td align="center" bgcolor="#670bd1" style="background-color:#670bd1;border-radius:10px;mso-padding-alt:14px 22px;">
                      <a href="${href}" style="display:inline-block;padding:14px 22px;border-radius:10px;color:#ffffff;font-size:16px;line-height:22px;font-weight:700;text-decoration:none;mso-padding-alt:0;">Entrar no Offboard</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 24px;font-size:14px;line-height:22px;color:#5b5069;">Se o botão não funcionar, <a href="${href}" style="color:#5a0ab6;text-decoration:underline;">abra o link de acesso</a>.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                  <tr>
                    <td bgcolor="#f5f0fc" style="padding:14px 16px;border-radius:10px;background-color:#f5f0fc;font-size:14px;line-height:21px;color:#493360;">${expires} ${retry}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 16px 0;font-size:13px;line-height:20px;color:#5b5069;">${ignore}</td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}
