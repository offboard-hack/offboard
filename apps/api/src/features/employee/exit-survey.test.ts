import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { defaultOrgId, exitSurveys } from "@offboard/db/schema";
import { initialDeparture, type Departure } from "@offboard/employee/departure";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";
import { syncExitSurvey } from "./exit-survey.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const answered: NonNullable<Departure["feedback"]> = {
  anonymous: true,
  assessment: 4,
  clarity: null,
  respect: null,
  comment: "",
  recommendation: 9,
  managerSupport: 5,
  teamRespect: null,
  communication: 3,
  equipmentReturn: 4,
  documents: 2,
  topics: ["Clareza de prazos"],
};

describe.skipIf(!url)("exit survey sync", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  beforeAll(() =>
    migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    }),
  );
  afterAll(() => db.$client.end());

  it("stores the ratings of a submitted feedback once and ignores the rest", async () => {
    const { id: caseId } = await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Pessoa da pesquisa",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
      email: randomUUID() + "@offboard.example",
    });

    const sync = (previous: Departure, feedback: Departure["feedback"]) =>
      db.transaction((tx) =>
        syncExitSurvey(tx, defaultOrgId, caseId, previous, { ...initialDeparture, feedback }),
      );

    const rows = () => db.select().from(exitSurveys).where(eq(exitSurveys.caseId, caseId));

    await sync(initialDeparture, null);
    await sync(initialDeparture, { ...answered, recommendation: null });
    expect(await rows()).toEqual([]);

    await sync(initialDeparture, answered);
    const [stored] = await rows();
    expect(stored).toMatchObject({
      npsScore: 9,
      responses: {
        assessment: 4,
        managerSupport: 5,
        communication: 3,
        equipmentReturn: 4,
        documents: 2,
      },
      topics: ["Clareza de prazos"],
    });
    expect(stored.responses).not.toHaveProperty("teamRespect");

    await sync({ ...initialDeparture, feedback: answered }, answered);
    expect(await rows()).toEqual([stored]);

    await sync(
      { ...initialDeparture, feedback: answered },
      { ...answered, recommendation: 4, topics: [] },
    );
    expect(await rows()).toMatchObject([{ npsScore: 4, topics: [] }]);

    const commented = { ...answered, comment: "  Muito bom  ", anonymous: false };
    await sync({ ...initialDeparture, feedback: answered }, commented);
    expect((await rows())[0].responses).toMatchObject({ comment: "Muito bom", anonymous: false });

    await sync({ ...initialDeparture, feedback: commented }, { ...commented, comment: "" });
    expect((await rows())[0].responses).not.toHaveProperty("comment");
  });
});
