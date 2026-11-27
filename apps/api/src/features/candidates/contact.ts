function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type ContactRequest = {
  name: string;
  email: string;
  company?: string | null;
  message: string;
};

function firstNameOf(name: string) {
  const [first] = name.trim().split(/\s+/);

  return first;
}

function asEmail(to: string, subject: string, paragraphs: string[]) {
  return {
    to,
    subject,
    text: paragraphs.join("\n\n"),
    html: paragraphs
      .map((paragraph) => `<p style="white-space:pre-wrap">${escapeHtml(paragraph)}</p>`)
      .join("\n"),
  };
}

export function confirmationEmail(to: string, candidateName: string, link: string) {
  const firstName = firstNameOf(candidateName);

  return asEmail(to, `Confirme sua mensagem para ${firstName}`, [
    "Olá.",
    `Alguém usou este e-mail para escrever para ${firstName} na busca de candidatos da Offboard. A mensagem só é enviada depois que você confirmar, neste link (vale por 24 horas):`,
    link,
    "Se não foi você, ignore este e-mail. Nada será enviado.",
  ]);
}

export function contactEmail(
  candidate: { email: string; name: string },
  request: ContactRequest,
  origin: string,
) {
  const firstName = firstNameOf(candidate.name);
  const sender = request.company ? `${request.name} (${request.company})` : request.name;

  return asEmail(candidate.email, `${request.name} quer falar com você sobre uma oportunidade`, [
    `Olá, ${firstName}.`,
    `${sender} encontrou seu currículo na busca de candidatos da Offboard e enviou esta mensagem:`,
    request.message,
    `Se tiver interesse, responda direto para ${request.email}. A Offboard não compartilhou seu e-mail. Ele só chega a essa pessoa se você responder.`,
    `Para sair da busca, desligue "Aparecer na busca pública de candidatos" em Preferências: ${origin}/colaborador?tela=preferencias`,
  ]);
}
