import type { TalentProfile } from "../../shared/talent-profile.js";

export type WelcomeMessage = { to: string; subject: string; text: string; html: string };

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function welcomeEmail(
  { email, name, sponsoredUntil }: Pick<TalentProfile, "email" | "name" | "sponsoredUntil">,
  origin: string,
) {
  const [firstName] = name.trim().split(/\s+/);
  const [year, month, day] = sponsoredUntil.split("-");

  const paragraphs = [
    `Olá, ${firstName}.`,
    "Você recebeu acesso ao app do Offboard para apoiar sua recolocação: vagas compatíveis com o seu perfil, um currículo adaptado para cada vaga e o acompanhamento das suas candidaturas.",
    `Entre com este email em ${origin}/app/entrar e enviaremos um link de acesso na hora.`,
    `O acesso patrocinado pela empresa vai até ${day}/${month}/${year}.`,
  ];

  return {
    to: email,
    subject: "Seu acesso ao Offboard",
    text: paragraphs.join("\n\n"),
    html: paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n"),
  } satisfies WelcomeMessage;
}
