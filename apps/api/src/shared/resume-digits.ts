import type { ResumeContent } from "@offboard/db/schema";

export const digitRuns = (text: string | null) => text?.match(/\p{Nd}+/gu) ?? [];

export function resumeDigits(content: ResumeContent) {
  const texts = [
    content.headline.text,
    content.summary.text,
    ...content.experiences.flatMap((experience) => [
      experience.company,
      experience.role,
      experience.start,
      experience.end,
      ...experience.bullets.map((bullet) => bullet.text),
    ]),
    ...content.education.flatMap((education) => [
      education.institution,
      education.degree,
      education.start,
      education.end,
    ]),
    ...content.skills.map((skill) => skill.name),
    ...content.languages.flatMap((language) => [language.name, language.level]),
  ];

  return new Set(texts.flatMap(digitRuns));
}
