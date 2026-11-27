import { z } from "zod";
import {
  addDays,
  expectStatus,
  parseBody,
  recordLogin,
  type Context,
  type Json,
  type Session,
} from "./context.js";
import { completedEvent, signWebhook } from "./webhook.js";

export type Role = "admin" | "rh" | "gestor" | "visualizador";

export type OrgSpec = {
  orgName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
};

export type Admin = { orgId: string; email: string; session: Session };

export type PersonSpec = {
  name: string;
  role: string;
  department: string;
  email: string;
  deadlineInDays: number;
};

export type Person = {
  caseId: string;
  email: string;
  name: string;
  department: string;
  role: string;
};

export type Collaborator = { person: Person; session: Session };

const sessionCookie = z.string().regex(/session_token=/);

const idBody = z.object({ id: z.string() });

type Audience = "member" | "employee";

export async function signIn(ctx: Context, audience: Audience, email: string) {
  const key = `${audience}:${email}`;
  const known = ctx.sessions.get(key);

  if (known) return known;

  const id = ctx.newId();

  const headers = {
    "x-offboard-audience": audience,
    "x-forwarded-for": `10.${parseInt(id.slice(0, 2), 16)}.${parseInt(id.slice(2, 4), 16)}.1`,
  };

  expectStatus(
    await ctx.http("POST", "/auth/email-otp/send-verification-otp", {
      body: { email, type: "sign-in" },
      headers,
    }),
    `Sending the sign-in code to ${email} (the API allows 5 codes per email every 15 minutes)`,
    200,
  );

  const verified = expectStatus(
    await ctx.http("POST", "/auth/sign-in/email-otp", {
      body: { email, otp: await ctx.readCode(email) },
      headers,
    }),
    `Signing in as ${email}`,
    200,
  );

  const cookie = verified.cookies
    .map((value) => value.split(";")[0])
    .find((value) => sessionCookie.safeParse(value).success);

  if (!cookie) throw new Error(`Signing in as ${email} did not set a session cookie`);

  const session: Session = { cookie };

  if (audience === "employee") {
    const reply = expectStatus(
      await ctx.http("GET", "/employee/session", { cookie }),
      "Reading the collaborator session",
      200,
    );

    session.grant = parseBody(
      reply,
      "Collaborator session",
      z.object({ grantId: z.string() }),
    ).grantId;
  }

  ctx.sessions.set(key, session);
  ctx.log(`signed in as ${audience === "member" ? "HR" : "collaborator"} ${email}`);

  return session;
}

export async function ensureOrg(ctx: Context, spec: OrgSpec) {
  const signup = expectStatus(
    await ctx.http("POST", "/signup", {
      body: {
        orgName: spec.orgName,
        slug: spec.slug,
        adminName: spec.adminName,
        adminEmail: spec.adminEmail,
      },
    }),
    `Signing up ${spec.orgName}`,
    201,
    409,
  );

  ctx.log(
    signup.status === 201 ? `created org ${spec.orgName}` : `org ${spec.orgName} already exists`,
  );

  const session = await signIn(ctx, "member", spec.adminEmail);

  const principal = parseBody(
    expectStatus(
      await ctx.http("GET", "/session", { cookie: session.cookie }),
      "Reading the HR session",
      200,
    ),
    "HR session",
    z.object({ orgId: z.string() }),
  );

  recordLogin(ctx, {
    who: `HR admin of ${spec.orgName}`,
    email: spec.adminEmail,
    where: `${ctx.webOrigin}/entrar, then Painel and Desligamentos`,
  });

  return { orgId: principal.orgId, email: spec.adminEmail, session } satisfies Admin;
}

export async function addTeamMember(
  ctx: Context,
  admin: Admin,
  member: { name: string; email: string; role: Role },
) {
  const reply = expectStatus(
    await ctx.http("POST", "/team", { body: member, cookie: admin.session.cookie }),
    `Adding ${member.email}`,
    201,
    409,
  );

  ctx.log(`${reply.status === 201 ? "added" : "kept"} ${member.role} ${member.email}`);

  recordLogin(ctx, {
    who: `HR ${member.role}`,
    email: member.email,
    where: `${ctx.webOrigin}/entrar, then Equipe`,
  });
}

const planList = z.array(
  z.object({ id: z.string(), slug: z.string(), monthlyPriceCents: z.number() }),
);

export async function listPlans(ctx: Context, admin: Admin) {
  const reply = expectStatus(
    await ctx.http("GET", "/billing/plans", { cookie: admin.session.cookie }),
    "Listing plans",
    200,
  );

  return parseBody(reply, "Plans", planList);
}

const subscriptionBody = z.object({
  id: z.string(),
  status: z.string(),
  plan: z.object({ slug: z.string(), monthlyPriceCents: z.number() }),
});

export async function sendWebhook(
  ctx: Context,
  secret: string,
  event: ReturnType<typeof completedEvent>,
) {
  const body = JSON.stringify(event);
  const headers = signWebhook(secret, event.id, Math.floor(Date.now() / 1000), body);

  return expectStatus(
    await ctx.http("POST", "/billing/webhook", { rawBody: body, headers }),
    "Delivering the payment event",
    200,
  );
}

export function paymentKeys(ctx: Context) {
  const apiKey = ctx.env.ABACATEPAY_API_KEY;
  const secret = ctx.env.ABACATEPAY_WEBHOOK_SECRET;

  if (!apiKey) return { skipped: "skipped: ABACATEPAY_API_KEY not set" } as const;

  if (!secret) return { skipped: "skipped: ABACATEPAY_WEBHOOK_SECRET not set" } as const;

  return { secret } as const;
}

export async function subscribeCompany(ctx: Context, admin: Admin, planSlug: string) {
  const keys = paymentKeys(ctx);

  if ("skipped" in keys) {
    ctx.log(`company plan ${planSlug} ${keys.skipped}`);

    return "skipped" as const;
  }

  const started = expectStatus(
    await ctx.http("POST", "/billing/subscription", {
      body: { planSlug },
      cookie: admin.session.cookie,
    }),
    `Subscribing to ${planSlug}`,
    200,
    409,
  );

  const current = await readSubscription(ctx, admin);

  if (started.status === 409 && current.status === "active") {
    ctx.log(`company subscription already active on ${current.plan.slug}`);

    return current.status;
  }

  const checkout = parseBody(
    expectStatus(
      await ctx.http("POST", "/billing/checkout", { cookie: admin.session.cookie }),
      "Opening the checkout",
      200,
    ),
    "Checkout",
    z.object({ checkoutId: z.string(), url: z.string() }),
  );

  ctx.log(`AbacatePay sandbox checkout: ${checkout.url}`);

  await sendWebhook(
    ctx,
    keys.secret,
    completedEvent({
      eventId: ctx.newId(),
      externalId: current.id,
      checkoutId: checkout.checkoutId,
      amountCents: current.plan.monthlyPriceCents,
    }),
  );

  const paid = await readSubscription(ctx, admin);

  ctx.log(`company subscription is ${paid.status} on ${paid.plan.slug}`);

  return paid.status;
}

async function readSubscription(ctx: Context, admin: Admin) {
  return parseBody(
    expectStatus(
      await ctx.http("GET", "/billing/subscription", { cookie: admin.session.cookie }),
      "Reading the subscription",
      200,
    ),
    "Subscription",
    subscriptionBody,
  );
}

export async function setBenefitPolicy(
  ctx: Context,
  admin: Admin,
  policy: {
    defaultPlanSlug: string;
    durationMonths: number;
    rules: {
      id: string;
      field: "department" | "role";
      operator: "equals" | "notEquals" | "contains";
      value: string;
      planSlug: string;
    }[];
  },
) {
  const plans = new Map((await listPlans(ctx, admin)).map((plan) => [plan.slug, plan.id]));

  const planId = (slug: string) => {
    const id = plans.get(slug);

    if (!id) throw new Error(`Plan ${slug} is not in the catalog`);

    return id;
  };

  expectStatus(
    await ctx.http("PUT", "/benefit-policy", {
      cookie: admin.session.cookie,
      body: {
        defaultPlanId: planId(policy.defaultPlanSlug),
        benefitDurationMonths: policy.durationMonths,
        rules: policy.rules.map(({ planSlug, ...rule }) => ({ ...rule, planId: planId(planSlug) })),
      },
    }),
    "Saving the benefit policy",
    204,
  );

  ctx.log(`benefit policy: default ${policy.defaultPlanSlug}, ${policy.rules.length} rules`);
}

const caseList = z.array(z.object({ id: z.string(), name: z.string() }));

export async function addPerson(ctx: Context, admin: Admin, spec: PersonSpec) {
  const created = await ctx.http("POST", "/offboardings", {
    cookie: admin.session.cookie,
    body: {
      name: spec.name,
      role: spec.role,
      department: spec.department,
      email: spec.email,
      deadline: addDays(ctx.today(), spec.deadlineInDays),
      invite: true,
    },
  });

  expectStatus(created, `Adding ${spec.name}`, 201, 409);

  const caseId =
    created.status === 201
      ? parseBody(created, "Offboarding", idBody).id
      : parseBody(
          expectStatus(
            await ctx.http("GET", "/offboardings", { cookie: admin.session.cookie }),
            "Listing offboardings",
            200,
          ),
          "Offboardings",
          caseList,
        ).find((item) => item.name === spec.name)?.id;

  if (!caseId) throw new Error(`${spec.name} exists with another email`);

  ctx.log(
    created.status === 201
      ? `added ${spec.name} (${spec.department}) and invited ${spec.email}`
      : `found ${spec.name} (${spec.department}), access for ${spec.email}`,
  );

  recordLogin(ctx, {
    who: `Collaborator ${spec.name}`,
    email: spec.email,
    where: `${ctx.webOrigin}/colaborador/entrar, then /colaborador`,
  });

  return {
    caseId,
    email: spec.email,
    name: spec.name,
    department: spec.department,
    role: spec.role,
  } satisfies Person;
}

export async function signInCollaborator(ctx: Context, person: Person) {
  const session = await signIn(ctx, "employee", person.email);

  return { person, session } satisfies Collaborator;
}

const meBody = z.object({ id: z.string() });

export async function openCareer(ctx: Context, collaborator: Collaborator) {
  const reply = expectStatus(
    await ctx.http("GET", "/me", { cookie: collaborator.session.cookie }),
    "Opening the career profile",
    200,
  );

  return parseBody(reply, "Career profile", meBody).id;
}

const assignmentList = z.array(
  z.object({ profileName: z.string(), assignedPlanName: z.string(), source: z.string() }),
);

export async function readBenefit(ctx: Context, admin: Admin, name: string) {
  const assignments = parseBody(
    expectStatus(
      await ctx.http("GET", "/benefit-assignments", { cookie: admin.session.cookie }),
      "Listing benefit assignments",
      200,
    ),
    "Benefit assignments",
    assignmentList,
  );

  const found = assignments.find((assignment) => assignment.profileName === name);

  ctx.log(
    found
      ? `${name} got benefit ${found.assignedPlanName} (source ${found.source})`
      : `${name} has no benefit assignment`,
  );

  return found;
}

export async function saveResume(ctx: Context, collaborator: Collaborator, content: Json) {
  expectStatus(
    await ctx.http("POST", "/me/resume", {
      cookie: collaborator.session.cookie,
      body: { content },
    }),
    "Saving the résumé",
    200,
  );

  ctx.log(`${collaborator.person.name} saved a base résumé`);
}

export async function ensureResume(ctx: Context, collaborator: Collaborator, content: Json) {
  const existing = await ctx.http("GET", "/me/resume", { cookie: collaborator.session.cookie });

  if (existing.status === 200) {
    ctx.log(`${collaborator.person.name} already has a base résumé`);

    return;
  }

  await saveResume(ctx, collaborator, content);
}

export async function savePreferences(ctx: Context, collaborator: Collaborator, preferences: Json) {
  expectStatus(
    await ctx.http("PUT", "/me/preferences", {
      cookie: collaborator.session.cookie,
      body: preferences,
    }),
    "Saving preferences",
    200,
  );

  ctx.log(`${collaborator.person.name} saved job preferences`);
}

const jobPage = z.object({ total: z.number(), matching: z.boolean() });

export async function listJobs(ctx: Context, collaborator: Collaborator) {
  const read = async (view: "compatible" | "all") =>
    parseBody(
      expectStatus(
        await ctx.http("GET", `/me/jobs?view=${view}`, { cookie: collaborator.session.cookie }),
        `Listing ${view} jobs`,
        200,
      ),
      "Jobs",
      jobPage,
    );

  const compatible = await read("compatible");
  const all = await read("all");

  ctx.log(
    `${collaborator.person.name} sees ${compatible.total} compatible of ${all.total} jobs` +
      (compatible.matching ? "" : " (matches are computed only with an AI key)"),
  );

  return { compatible: compatible.total, all: all.total };
}

const accessSettings = z.object({
  email: z.string().nullable(),
  plan: z.unknown(),
  revision: z.number(),
});

export async function setCareerSponsoredUntil(
  ctx: Context,
  admin: Admin,
  person: Person,
  date: string,
) {
  const path = `/employee-access/${person.caseId}`;

  const settings = parseBody(
    expectStatus(
      await ctx.http("GET", path, { cookie: admin.session.cookie }),
      "Reading access",
      200,
    ),
    "Employee access",
    accessSettings,
  );

  expectStatus(
    await ctx.http("PUT", path, {
      cookie: admin.session.cookie,
      body: {
        email: settings.email,
        plan: settings.plan,
        revision: settings.revision,
        careerSponsoredUntil: date,
      },
    }),
    "Saving career sponsorship",
    200,
  );

  ctx.log(`${person.name} career sponsorship now ends on ${date}`);
}

const planBody = z.object({
  upgrade: z.object({ offered: z.boolean() }),
  individual: z.object({ status: z.string() }).nullable(),
});

async function readPlan(ctx: Context, cookie: string) {
  return parseBody(
    expectStatus(await ctx.http("GET", "/me/plan", { cookie }), "Reading the plan", 200),
    "Plan",
    planBody,
  );
}

export async function upgradeCareerPro(
  ctx: Context,
  collaborator: Collaborator,
  profileId: string,
) {
  const keys = paymentKeys(ctx);

  if ("skipped" in keys) {
    ctx.log(`Carreira Pro ${keys.skipped}`);

    return "skipped" as const;
  }

  const cookie = collaborator.session.cookie;

  const before = await readPlan(ctx, cookie);

  if (before.individual?.status === "active") {
    ctx.log(`${collaborator.person.name} Carreira Pro already active`);

    return "active";
  }

  const checkout = parseBody(
    expectStatus(
      await ctx.http("POST", "/me/plan/checkout", { cookie }),
      "Starting the Carreira Pro checkout",
      200,
    ),
    "Checkout",
    z.object({ url: z.string() }),
  );

  ctx.log(`AbacatePay sandbox checkout: ${checkout.url}`);

  await sendWebhook(
    ctx,
    keys.secret,
    completedEvent({ eventId: ctx.newId(), externalId: `talent:${profileId}`, amountCents: 7900 }),
  );

  const plan = await readPlan(ctx, cookie);

  ctx.log(`${collaborator.person.name} Carreira Pro is ${plan.individual?.status ?? "missing"}`);

  return plan.individual?.status ?? "missing";
}

const caseBody = z.object({
  tasks: z.array(z.object({ id: z.string(), status: z.string() })),
});

export async function completeChecklist(ctx: Context, admin: Admin, person: Person) {
  const detail = parseBody(
    expectStatus(
      await ctx.http("GET", `/offboardings/${person.caseId}`, { cookie: admin.session.cookie }),
      "Reading the offboarding",
      200,
    ),
    "Offboarding",
    caseBody,
  );

  const open = detail.tasks.filter((task) => task.status !== "done");

  for (const task of open) {
    expectStatus(
      await ctx.http("PATCH", `/tasks/${task.id}/status`, {
        cookie: admin.session.cookie,
        body: { status: "done" },
      }),
      "Completing a task",
      200,
    );
  }

  ctx.log(`${person.name}: ${open.length} of ${detail.tasks.length} tasks moved to done`);

  return { moved: open.length, total: detail.tasks.length };
}

export async function submitExitSurvey(ctx: Context, admin: Admin, person: Person) {
  expectStatus(
    await ctx.http("POST", "/exit-surveys", {
      cookie: admin.session.cookie,
      body: {
        caseId: person.caseId,
        npsScore: 9,
        responses: {
          assessment: 4,
          managerSupport: 5,
          teamRespect: 5,
          communication: 5,
          equipmentReturn: 4,
          documents: 4,
          comment: "Processo claro e respeitoso do início ao fim.",
          anonymous: false,
        },
        topics: ["Respeito na comunicação", "Clareza de prazos"],
      },
    }),
    "Submitting the exit survey",
    201,
  );

  ctx.log(`${person.name} exit survey submitted (NPS 9)`);
}
