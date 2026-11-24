import type { TalentProfile } from "../../shared/talent-profile.js";

export type WelcomeMessage = { to: string; subject: string; text: string };

export function welcomeEmail(
  { email, name, sponsoredUntil }: Pick<TalentProfile, "email" | "name" | "sponsoredUntil">,
  origin: string,
) {
  const [firstName] = name.trim().split(/\s+/);
  const [year, month, day] = sponsoredUntil.split("-");

  return {
    to: email,
    subject: "Seu acesso ao Offboard",
    text: [
      `Olá, ${firstName}.`,
      "",
      "Você recebeu acesso ao app do Offboard para apoiar sua recolocação: vagas compatíveis com o seu perfil, um currículo adaptado para cada vaga e o acompanhamento das suas candidaturas.",
      "",
      `Entre com este email em ${origin}/app/entrar e enviaremos um link de acesso na hora.`,
      "",
      `O acesso patrocinado pela empresa vai até ${day}/${month}/${year}.`,
    ].join("\n"),
  } satisfies WelcomeMessage;
}
