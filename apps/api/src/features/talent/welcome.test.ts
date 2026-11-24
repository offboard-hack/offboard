import { describe, expect, it } from "vitest";
import { welcomeEmail } from "./welcome.js";

describe("welcomeEmail", () => {
  it("greets by first name and points to the app sign-in without a token", () => {
    const message = welcomeEmail(
      { email: "marina.lopes@exemplo.com", name: "Marina Lopes", sponsoredUntil: "2027-05-31" },
      "https://app.off-board.xyz",
    );

    expect(message).toEqual({
      to: "marina.lopes@exemplo.com",
      subject: "Seu acesso ao Offboard",
      text: [
        "Olá, Marina.",
        "",
        "Você recebeu acesso ao app do Offboard para apoiar sua recolocação: vagas compatíveis com o seu perfil, um currículo adaptado para cada vaga e o acompanhamento das suas candidaturas.",
        "",
        "Entre com este email em https://app.off-board.xyz/app/entrar e enviaremos um link de acesso na hora.",
        "",
        "O acesso patrocinado pela empresa vai até 31/05/2027.",
      ].join("\n"),
    });
    expect(message.text).not.toMatch(/token=/);
  });

  it("uses the whole name when it has a single word", () => {
    const { text } = welcomeEmail(
      { email: "ana@exemplo.com", name: "Ana", sponsoredUntil: "2026-12-01" },
      "http://localhost:5173",
    );

    expect(text.split("\n")[0]).toBe("Olá, Ana.");
    expect(text).toContain("http://localhost:5173/app/entrar");
    expect(text).toContain("01/12/2026");
  });
});
