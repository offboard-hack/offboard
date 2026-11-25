import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { defaultOrgId, employeeAccess } from "@offboard/db/schema";
import { emptyEmployeePlan } from "@offboard/employee";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!url)("employee access transactions", () => {
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

  it("holds the access row until the operation using the active plan finishes", async () => {
    const { id: caseId } = await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Pessoa de teste",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
    });

    const email = randomUUID() + "@offboard.example";
    const plan = { ...emptyEmployeePlan, bookingDays: ["2027-01-26"] };
    expect(
      await repos.employee.saveSettings(defaultOrgId, caseId, { email, plan, revision: 0 }),
    ).toBe("saved");

    const [access] = await db
      .select()
      .from(employeeAccess)
      .where(eq(employeeAccess.caseId, caseId));

    let entered!: () => void;
    let release!: () => void;
    const holdingAccess = new Promise<void>((resolve) => (entered = resolve));
    const finish = new Promise<void>((resolve) => (release = resolve));

    const operation = repos.employee.withAccess(
      { id: randomUUID(), caseId, grantId: access.grantId, email, name: "Pessoa de teste" },
      "write",
      async (data) => {
        entered();
        await finish;

        return data.readJourney();
      },
    );

    try {
      await holdingAccess;
      await expect(
        db.transaction((tx) =>
          tx
            .select({ revision: employeeAccess.revision })
            .from(employeeAccess)
            .where(eq(employeeAccess.caseId, caseId))
            .for("update", { noWait: true }),
        ),
      ).rejects.toMatchObject({ cause: { code: "55P03" } });
    } finally {
      release();
    }

    expect((await operation)?.plan.bookingDays).toEqual(["2027-01-26"]);
    const revisedPlan = { ...plan, bookingDays: [] };
    expect(
      await repos.employee.saveSettings(defaultOrgId, caseId, {
        email,
        plan: revisedPlan,
        revision: 1,
      }),
    ).toBe("saved");
    expect(await repos.employee.readSettings(defaultOrgId, caseId)).toMatchObject({
      plan: revisedPlan,
      revision: 2,
    });
  });
});
