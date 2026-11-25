import type { ResumeContent } from "@offboard/db/schema";
import type { toPreferences } from "./talent-preferences.js";

type ProfileFields = ReturnType<typeof toPreferences>["profileFields"];

export function shareFilteredResume(content: ResumeContent, fields: ProfileFields) {
  const { contact } = content;

  return {
    ...content,
    contact: {
      ...contact,
      phone: fields.phone.share ? contact.phone : null,
      city: fields.city.share ? contact.city : null,
      links: contact.links.filter((link) =>
        /linkedin\.com/i.test(link) ? fields.linkedin.share : fields.portfolio.share,
      ),
    },
  };
}
