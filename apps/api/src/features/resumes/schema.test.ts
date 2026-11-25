import type { Static } from "elysia";
import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { ResumeContent } from "./content.js";
import { resumeContentInputSchema, resumeContentSchema } from "./content.js";
import type { ResumeView } from "./repository.js";
import { resumeContentBody, resumeResponse, versionResponse } from "./schema.js";
import type { VersionView } from "./versions.js";

describe("résumé schemas", () => {
  it("keep the HTTP, validation and stored shapes identical", () => {
    expectTypeOf<Static<typeof resumeResponse>>().toEqualTypeOf<ResumeView>();
    expectTypeOf<Static<typeof resumeContentBody>>().toEqualTypeOf<
      z.input<typeof resumeContentInputSchema>
    >();
    expectTypeOf<z.output<typeof resumeContentSchema>>().toEqualTypeOf<ResumeContent>();
    expectTypeOf<Static<typeof versionResponse>>().toEqualTypeOf<VersionView>();
    expectTypeOf<NonNullable<VersionView["application"]>["status"]>().toEqualTypeOf<
      "sent" | "in_review" | "interview" | "offer" | "closed"
    >();
  });
});
