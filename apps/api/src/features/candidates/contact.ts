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
  company?: string;
  message: string;
};

export function contactEmail(
  candidate: { email: string; name: string },
  request: ContactRequest,
  origin: string,
) {
  const [firstName] = candidate.name.trim().split(/\s+/);
  const sender = request.company ? `${request.name} (${request.company})` : request.name;

  const paragraphs = [
    `Olá, ${firstName}.`,
    `${sender} encontrou seu currículo na busca de candidatos da Offboard e enviou esta mensagem:`,
    request.message,
    `Se tiver interesse, responda direto para ${request.email}. A Offboard não compartilhou seu e-mail. Ele só chega a essa pessoa se você responder.`,
    `Para sair da busca, desligue "Aparecer na busca pública de candidatos" em Preferências: ${origin}/colaborador?tela=preferencias`,
  ];

  return {
    to: candidate.email,
    subject: `${request.name} quer falar com você sobre uma oportunidade`,
    text: paragraphs.join("\n\n"),
    html: paragraphs
      .map((paragraph) => `<p style="white-space:pre-wrap">${escapeHtml(paragraph)}</p>`)
      .join("\n"),
  };
}
