import { describe, expect, it } from "vitest";
import { canonicalValue, topicOf } from "./topics.js";

describe("finds the topic of a question", () => {
  it.each([
    ["Consentimento - Diversidade e Inclusão (D&I)", "consent"],
    ["I consent to the use of my demographic data", "consent"],
    ["Do you have any relatives currently working at Bees Brasil?", "relative"],
    ["Contato com pessoas que já trabalham na empresa", "relative"],
    ["Você tem parentes na empresa?", "relative"],
    ["Você tem parentes que trabalham na empresa?", "relative"],
    ["DIVERSITY: Which pronoun is right for you? (Pronouns relate to gender identity)", "pronoun"],
    ["What is your sexual orientation?", "orientation"],
    ["Qual a sua orientação sexual?", "orientation"],
    ["Você se identifica como pessoa trans?", "trans"],
    ["What is your gender identity?", "gender"],
    ["Gênero", "gender"],
    ["Sexo", "gender"],
    ["What’s your race or skin color?", "race"],
    ["Raça/cor", "race"],
    ["Etnia", "race"],
    ["Você é PcD?", "disability"],
    ["DISABILITY: Would you like to apply as a person with disabilities?", "disability"],
  ])("%s → %s", (label, topic) => {
    expect(topicOf(label)).toBe(topic);
  });

  it.each([
    "Qual a cor do seu cabelo?",
    "Como você conheceu a nossa empresa?",
    "Are you a currently Group ABInBev | Ambev employee?",
    "If yes, what is the relationship with the person?",
    "Transporte próprio?",
    "Você é cisgênero?",
    "Consentimento LGPD para tratamento dos dados pessoais",
    "I consent to a background check",
    "Você tem algum familiar com deficiência?",
    "Seus familiares têm alguma deficiência (PcD)?",
    "Does a family member of yours have a disability?",
    "Seu cônjuge se identifica como pessoa trans?",
    "Do you have relatives who are public officials (PEP)?",
    "Você tem algum parente que seja pessoa politicamente exposta?",
    "Qual o seu gênero e raça?",
    "Qual a sua raça, deficiência ou orientação sexual?",
  ])("leaves %s without a topic", (label) => {
    expect(topicOf(label)).toBeUndefined();
  });
});

describe("reads an option as a canonical value", () => {
  it.each([
    ["gender", "Female", "female"],
    ["gender", "Mulher", "female"],
    ["gender", "Male", "male"],
    ["gender", "Masculino", "male"],
    ["gender", "Non-binary", "nonbinary"],
    ["gender", "Não binário", "nonbinary"],
    ["gender", "Cisgender", "cis"],
    ["gender", "Transgender", "trans"],
    ["gender", "I prefer not to disclose", "decline"],
    ["gender", "Prefiro não informar", "decline"],
    ["pronoun", "He / Him", "he"],
    ["pronoun", "Ela/dela", "she"],
    ["pronoun", "They / Them", "they"],
    ["orientation", "Heterosexual", "straight"],
    ["orientation", "Bissexual", "bisexual"],
    ["orientation", "Gay", "gay"],
    ["orientation", "Lésbica", "lesbian"],
    ["orientation", "Assexual", "asexual"],
    ["orientation", "Pansexual", "pansexual"],
    ["race", "White", "white"],
    ["race", "Parda", "brown"],
    ["race", "Preta", "black"],
    ["race", "Amarela", "asian"],
    ["race", "Indígena", "indigenous"],
    ["disability", "Não possuo deficiência", "no"],
    ["disability", "Visual Disability", "visual"],
    ["disability", "Deficiência Auditiva (ex: perda bilateral, surdez...)", "hearing"],
    ["disability", "Physical Disability", "physical"],
    ["disability", "Intellectual Disability", "intellectual"],
    ["disability", "Mental Disability", "mental"],
    ["disability", "Autistic Spectrum Disorder", "autism"],
    ["relative", "No", "no"],
    ["relative", "Nenhuma das anteriores.", "no"],
    ["relative", "Sim", "yes"],
    ["consent", "Sim. Eu concordo com a coleta", "yes"],
    ["consent", "Não. Eu não concordo com a coleta", "no"],
    ["trans", "Prefiro não responder", "decline"],
    ["trans", "I don't wish to answer", "decline"],
    ["relative", "I do not want to disclose", "decline"],
    ["relative", "I don't have relatives here", "no"],
    ["orientation", "Prefiro não dizer", "decline"],
  ] as const)("%s: %s → %s", (topic, label, value) => {
    expect(canonicalValue(topic, label)).toBe(value);
  });

  it.each([
    ["gender", "Other"],
    ["race", "Outra"],
    ["relative", "Eu e esta pessoa estudamos juntos."],
    ["disability", "Sim"],
    ["disability", "Deficiência Mental/Psicossocial (ex: Transtorno do Espectro Autista...)"],
    ["orientation", "Gay or Lesbian"],
    ["race", "Negra (preta ou parda)"],
    ["gender", "Mulher cisgênero"],
    ["orientation", "Homossexual"],
    ["orientation", "Homosexual"],
    ["trans", "Não sei"],
    ["trans", "Não tenho certeza"],
    ["disability", "Não se aplica"],
    ["relative", "Not sure"],
    ["race", "N/A"],
  ] as const)("does not read %s: %s", (topic, label) => {
    expect(canonicalValue(topic, label)).toBeUndefined();
  });
});
