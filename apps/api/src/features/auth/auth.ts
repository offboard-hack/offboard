import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "@offboard/db/client";
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
  employeeAccess,
  offboardingCases,
  organizations,
  teamMembers,
} from "@offboard/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { magicLink } from "better-auth/plugins/magic-link";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { PortalAuth, TalentPrincipal } from "../../shared/portal-auth.js";
import { isEmployeeApp } from "../../shared/employee-auth.js";
import { parseStaffEmails } from "../../shared/staff-access.js";
import { createEmailSender, type CloudflareEmailBinding } from "./email.js";
import { signInCodeEmail, signInEmail, signInLinkMinutes } from "./sign-in-email.js";

const authPath = "/api/auth";
const verifyPath = "/magic-link/verify";
const codeRequestPath = "/email-otp/send-verification-otp";
const codeSignInPath = "/sign-in/email-otp";
const codeLifetimeSeconds = 10 * 60;
const codeRequestsPerEmail = 5;
const codeRequestWindowMs = 15 * 60 * 1000;
const signInPath = `${authPath}/sign-in/magic-link`;

const browserEndpoints = new Set([
  `GET ${authPath}${verifyPath}`,
  `POST ${authPath}/sign-in/magic-link`,
  `POST ${authPath}/sign-out`,
  `POST ${authPath}${codeRequestPath}`,
  `POST ${authPath}${codeSignInPath}`,
]);

const nativeEndpoints = new Set([codeRequestPath, codeSignInPath, "/sign-out"]);
const codeEndpoints = new Set([codeRequestPath, codeSignInPath]);
const linkPaths = new Set([verifyPath, "/sign-in/magic-link"]);
const employeeCookie = "offboard-colaborador";
const staffCookie = "offboard-staff";

export const codeAudienceHeader = "x-offboard-audience";

const memberFields = {
  id: teamMembers.id,
  name: teamMembers.name,
  email: teamMembers.email,
  role: teamMembers.role,
  orgId: teamMembers.orgId,
  orgName: organizations.name,
};

const originSchema = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

    return (
      (url.origin === value || `${url.origin}/` === value) && (local || url.protocol === "https:")
    );
  })
  .transform((value) => new URL(value).origin);

const authSecret = z.string().min(32);

const linkToken = z
  .string()
  .transform((token) => token.split("."))
  .pipe(z.tuple([z.literal("t"), z.uuid(), z.string().min(1)]))
  .transform(([, id]) => id);

const callbackQuery = z.object({ token: linkToken });
const callbackContext = z.object({ query: callbackQuery });
const otpEmail = z.object({ email: z.email().transform((email) => email.toLowerCase()) });

const sessionAudience = z.union([
  z
    .object({ talentProfileId: z.string() })
    .transform(({ talentProfileId }) => ({ audience: "talent" as const, id: talentProfileId })),
  z
    .object({ memberId: z.string() })
    .transform(({ memberId }) => ({ audience: "member" as const, id: memberId })),
  z
    .object({ staffEmail: z.string() })
    .transform(({ staffEmail }) => ({ audience: "staff" as const, id: staffEmail })),
]);

function codeAudienceOf(header: string | null) {
  if (header === "member") return "member" as const;

  if (header === "staff") return "staff" as const;

  return "employee" as const;
}

const appCallback = z.object({ callbackURL: z.string().regex(/^\/app(?:[/?]|$)/) });
const talentSession = z.object({ talentProfileId: z.string() });

type TalentDirectory = {
  findForSignIn(email: string, id?: string): Promise<TalentPrincipal | undefined>;
  markSignedIn(id: string): Promise<void>;
};

async function isAppSignIn(request: Request) {
  const body = await request
    .clone()
    .json()
    .catch(() => undefined);

  return appCallback.safeParse(body).success;
}

export function createAuth({
  db,
  origin,
  secret,
  talent,
  sendLink,
  sendCode,
  onVercel = false,
  ipAddressHeaders = onVercel ? ["x-vercel-forwarded-for"] : [],
  staffEmails,
  backofficeOrigin,
}: {
  db: Database;
  origin: string;
  secret: string;
  talent: TalentDirectory;
  staffEmails: ReadonlySet<string>;
  backofficeOrigin?: string;
  sendLink: (message: { email: string; url: string }) => Promise<void>;
  sendCode?: (message: { email: string; code: string }) => Promise<void>;
  onVercel?: boolean;
  ipAddressHeaders?: string[];
}) {
  const schema = {
    user: authUser,
    session: authSession,
    account: authAccount,
    verification: authVerification,
    rateLimit: authRateLimit,
  };

  const normalizedEmail = sql<string>`lower(${teamMembers.email})`;

  async function findMember(email: string, memberId?: string) {
    const [member] = await db
      .select(memberFields)
      .from(teamMembers)
      .innerJoin(organizations, eq(teamMembers.orgId, organizations.id))
      .where(
        and(
          eq(normalizedEmail, email.toLowerCase()),
          memberId ? eq(teamMembers.id, memberId) : undefined,
        ),
      );

    return member;
  }

  const normalizedEmployeeEmail = sql<string>`lower(${employeeAccess.email})`;

  type CodeScope = {
    audience: "employee" | "member" | "staff";
    grant: Awaited<ReturnType<typeof findEmployee>>;
    member: Awaited<ReturnType<typeof findMember>> | undefined;
    staffEmail: string | undefined;
  };

  const codeScope = new AsyncLocalStorage<CodeScope>();

  async function findEmployee(email: string, binding?: { caseId: string; grantId: string }) {
    const [employee] = await db
      .select({
        caseId: employeeAccess.caseId,
        name: offboardingCases.name,
        email: employeeAccess.email,
        grantId: employeeAccess.grantId,
      })
      .from(employeeAccess)
      .innerJoin(offboardingCases, eq(employeeAccess.caseId, offboardingCases.id))
      .where(
        and(
          eq(normalizedEmployeeEmail, email.toLowerCase()),
          binding && eq(employeeAccess.caseId, binding.caseId),
          binding && eq(employeeAccess.grantId, binding.grantId),
        ),
      );

    return employee?.email ? { ...employee, email: employee.email } : null;
  }

  function invalidCode() {
    return new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "Invalid OTP" });
  }

  function requireCodeSubject() {
    const scope = codeScope.getStore();

    if (scope?.audience === "member" && scope.member) {
      return { audience: "member" as const, member: scope.member };
    }

    if (scope?.audience === "employee" && scope.grant) {
      return { audience: "employee" as const, grant: scope.grant };
    }

    if (scope?.audience === "staff" && scope.staffEmail) {
      return { audience: "staff" as const, email: scope.staffEmail };
    }

    throw invalidCode();
  }

  function subjectName(subject: ReturnType<typeof requireCodeSubject>) {
    if (subject.audience === "member") return subject.member.name;

    if (subject.audience === "staff") return subject.email;

    return subject.grant.name;
  }

  function sessionSubject(subject: ReturnType<typeof requireCodeSubject>) {
    if (subject.audience === "member") return { memberId: subject.member.id };

    if (subject.audience === "staff") return { staffEmail: subject.email };

    return { employeeCaseId: subject.grant.caseId, employeeGrantId: subject.grant.grantId };
  }

  async function codeRecipient(email: string) {
    const scope = codeScope.getStore();

    if (scope?.audience === "staff") return scope.staffEmail === email;

    return scope?.audience === "member"
      ? scope.member && findMember(email, scope.member.id)
      : scope?.grant && findEmployee(email, scope.grant);
  }

  async function codeRequestsExceeded(request: Request) {
    const body = otpEmail.safeParse(
      await request
        .clone()
        .json()
        .catch(() => undefined),
    );

    if (!body.success) return false;

    const key = `offboard:code-email:${createHmac("sha256", secret).update(body.data.email).digest("hex")}`;
    const now = Date.now();
    const expired = sql`${authRateLimit.lastRequest} <= ${now - codeRequestWindowMs}`;

    const [row] = await db
      .insert(authRateLimit)
      .values({ id: randomUUID(), key, count: 1, lastRequest: now })
      .onConflictDoUpdate({
        target: authRateLimit.key,
        set: {
          count: sql`case when ${expired} then 1 else ${authRateLimit.count} + 1 end`,
          lastRequest: sql`case when ${expired} then ${now} else ${authRateLimit.lastRequest} end`,
        },
      })
      .returning({ count: authRateLimit.count });

    return row.count > codeRequestsPerEmail;
  }

  async function finalizeEmployeeSession(
    grant: NonNullable<Awaited<ReturnType<typeof findEmployee>>>,
  ) {
    return db.transaction(async (tx) => {
      const [active] = await tx
        .select({ caseId: employeeAccess.caseId })
        .from(employeeAccess)
        .where(
          and(
            eq(employeeAccess.caseId, grant.caseId),
            eq(employeeAccess.grantId, grant.grantId),
            eq(normalizedEmployeeEmail, grant.email.toLowerCase()),
          ),
        )
        .for("share");

      if (active) return true;

      await tx
        .delete(authSession)
        .where(
          and(
            eq(authSession.employeeCaseId, grant.caseId),
            eq(authSession.employeeGrantId, grant.grantId),
          ),
        );

      return false;
    });
  }

  const buildAuth = (cookiePrefix: string, trustedOrigins = [origin]) =>
    betterAuth({
      appName: "Offboard",
      baseURL: origin,
      basePath: authPath,
      secret,
      database: drizzleAdapter(db, { provider: "pg", schema }),
      trustedOrigins,
      advanced: {
        cookiePrefix,
        useSecureCookies: origin.startsWith("https:"),
        ipAddress: { ipAddressHeaders },
      },
      rateLimit: { enabled: true, storage: "database" },
      session: {
        expiresIn: 12 * 60 * 60,
        updateAge: 60 * 60,
        additionalFields: {
          memberId: { type: "string", required: false, input: false },
          employeeCaseId: { type: "string", required: false, input: false },
          employeeGrantId: { type: "string", required: false, input: false },
          talentProfileId: { type: "string", required: false, input: false },
          staffEmail: { type: "string", required: false, input: false },
        },
      },
      hooks: {
        before: createAuthMiddleware(async (context) => {
          if (context.path === verifyPath && !callbackQuery.safeParse(context.query).success) {
            throw context.redirect(`${origin}/entrar?error=INVALID_TOKEN`);
          }

          if (context.path === codeRequestPath || context.path === codeSignInPath) {
            const scope = codeScope.getStore();
            const parsed = otpEmail.safeParse(context.body);

            if (scope && parsed.success) {
              if (scope.audience === "member") scope.member = await findMember(parsed.data.email);
              else if (scope.audience === "staff")
                scope.staffEmail = staffEmails.has(parsed.data.email)
                  ? parsed.data.email
                  : undefined;
              else scope.grant = await findEmployee(parsed.data.email);
            }
          }

          if (context.path === codeSignInPath) requireCodeSubject();
        }),
      },
      databaseHooks: {
        user: {
          create: {
            async before(user, context) {
              if (context?.path === codeSignInPath) {
                const subject = requireCodeSubject();

                return { data: { name: subjectName(subject), image: null } };
              }

              const profileId = callbackContext.parse(context).query.token;
              const invitee = await talent.findForSignIn(user.email, profileId);

              return invitee ? { data: { name: invitee.name } } : false;
            },
          },
        },
        session: {
          create: {
            async before(session, context) {
              if (context?.path === codeSignInPath) {
                const subject = requireCodeSubject();

                return { data: sessionSubject(subject) };
              }

              const profileId = callbackContext.parse(context).query.token;

              const [user] = await db
                .select({ email: authUser.email })
                .from(authUser)
                .where(and(eq(authUser.id, session.userId), eq(authUser.emailVerified, true)));

              if (!user) return false;

              const invitee = await talent.findForSignIn(user.email, profileId);

              return invitee ? { data: { talentProfileId: invitee.id } } : false;
            },
            async after(session) {
              const created = talentSession.safeParse(session);

              if (created.success) await talent.markSignedIn(created.data.talentProfileId);
            },
          },
        },
      },
      plugins: [
        emailOTP({
          expiresIn: codeLifetimeSeconds,
          allowedAttempts: 3,
          storeOTP: {
            async hash(otp) {
              const scope = codeScope.getStore();

              const binding =
                scope?.audience === "member"
                  ? `member-otp:${scope.member?.id ?? "unassigned"}`
                  : `employee-otp:${scope?.grant?.grantId ?? "unassigned"}`;

              return createHmac("sha256", secret)
                .update(`offboard:${binding}:${otp}`)
                .digest("hex");
            },
          },
          async sendVerificationOTP({ email, otp, type }) {
            if (type === "sign-in" && sendCode && (await codeRecipient(email))) {
              await sendCode({ email, code: otp });
            }
          },
        }),
        magicLink({
          expiresIn: signInLinkMinutes * 60,
          storeToken: "hashed",
          async generateToken(email) {
            const invitee = await talent.findForSignIn(email);

            return `t.${invitee?.id ?? "uninvited"}.${randomBytes(32).toString("base64url")}`;
          },
          async sendMagicLink({ email, token, url }) {
            const link = linkToken.safeParse(token);

            if (link.success && (await talent.findForSignIn(email, link.data))) {
              await sendLink({ email, url });
            }
          },
        }),
      ],
    });

  const memberAuth = buildAuth("better-auth");
  const employeeAuth = buildAuth(employeeCookie);

  const staffAuth = buildAuth(
    staffCookie,
    backofficeOrigin ? [origin, backofficeOrigin] : [origin],
  );

  return {
    async handler(request) {
      const url = new URL(request.url);
      const path = url.pathname.slice(authPath.length);

      if (!browserEndpoints.has(`${request.method} ${url.pathname}`)) {
        return new Response(null, { status: 404 });
      }

      const native = nativeEndpoints.has(path) && isEmployeeApp(request, origin);

      const codeAudience = codeAudienceOf(request.headers.get(codeAudienceHeader));

      const requestOrigin = request.headers.get("origin");

      const staffOrigin =
        codeAudience === "staff" && nativeEndpoints.has(path) ? backofficeOrigin : undefined;

      if (
        request.method === "POST" &&
        requestOrigin !== origin &&
        requestOrigin !== staffOrigin &&
        !native
      ) {
        return new Response(null, { status: 403 });
      }

      if (native && codeAudience !== "employee" && codeEndpoints.has(path)) {
        return new Response(null, { status: 403 });
      }

      if (path === codeRequestPath && (await codeRequestsExceeded(request))) {
        return Response.json(
          { code: "TOO_MANY_REQUESTS", message: "Too many requests. Please try again later." },
          { status: 429, headers: { "cache-control": "no-store" } },
        );
      }

      let authRequest = request;

      if (native) {
        const headers = new Headers(request.headers);
        headers.set("origin", origin);

        const init = {
          method: request.method,
          headers,
          body: request.body,
          duplex: "half",
        } as const;

        authRequest = new Request(request.url, init);
      }

      if (url.pathname === `${authPath}${verifyPath}` && !url.searchParams.get("callbackURL")) {
        url.searchParams.set("callbackURL", "/");
        authRequest = new Request(url, request);
      }

      if (url.pathname === signInPath && !(await isAppSignIn(request))) {
        return new Response(null, { status: 404 });
      }

      const employeeSignOut =
        path === "/sign-out" &&
        (request.headers.get(codeAudienceHeader) === "employee" ||
          Boolean(request.headers.get("cookie")?.includes(`${employeeCookie}.session_token=`)));

      let auth = employeeAuth;

      if (codeAudience === "staff") auth = staffAuth;
      else if (
        codeAudience !== "employee" ||
        linkPaths.has(path) ||
        (path === "/sign-out" && !employeeSignOut)
      )
        auth = memberAuth;

      const scope: CodeScope = {
        audience: codeAudience,
        grant: null,
        member: undefined,
        staffEmail: undefined,
      };

      const response = await codeScope.run(scope, async () => {
        const result = await auth.handler(authRequest);

        if (
          path === codeSignInPath &&
          result.ok &&
          scope.grant &&
          !(await finalizeEmployeeSession(scope.grant))
        ) {
          return Response.json({ code: "INVALID_OTP", message: "Invalid OTP" }, { status: 400 });
        }

        return result;
      });

      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      headers.set("referrer-policy", "no-referrer");

      return new Response(response.body, { status: response.status, headers });
    },
    async resolvePrincipal(headers) {
      const session =
        (await staffAuth.api.getSession({ headers })) ??
        (await memberAuth.api.getSession({ headers }));

      if (!session) return { kind: "anonymous" };

      const signedIn = sessionAudience.safeParse(session.session);

      if (!session.user.emailVerified || !signedIn.success) return { kind: "forbidden" };

      const { audience, id } = signedIn.data;
      const email = session.user.email.toLowerCase();

      if (audience === "staff") {
        return staffEmails.has(id)
          ? { kind: "staff" as const, email: id }
          : { kind: "forbidden" as const };
      }

      if (audience === "talent") {
        const profile = await talent.findForSignIn(email, id);

        return profile
          ? {
              kind: "talent",
              profile: { id: profile.id, name: profile.name, email: profile.email },
            }
          : { kind: "forbidden" };
      }

      const member = await findMember(email, id);

      return member ? { kind: "authenticated", principal: member } : { kind: "forbidden" };
    },
    async resolveEmployee(headers) {
      const session = await employeeAuth.api.getSession({ headers });

      if (
        !session?.user.emailVerified ||
        !session.session.employeeCaseId ||
        !session.session.employeeGrantId
      ) {
        return null;
      }

      const employee = await findEmployee(session.user.email, {
        caseId: session.session.employeeCaseId,
        grantId: session.session.employeeGrantId,
      });

      return employee ? { id: session.user.id, ...employee } : null;
    },
  } satisfies PortalAuth;
}

export function createRuntimeAuth(
  db: Database,
  talent: TalentDirectory,
  webOrigin?: string,
  {
    env = process.env,
    ipAddressHeaders,
    cloudflareEmail,
    deferMagicLinkDelivery,
  }: {
    env?: Record<string, string | undefined>;
    ipAddressHeaders?: string[];
    cloudflareEmail?: CloudflareEmailBinding;
    deferMagicLinkDelivery?: (delivery: Promise<void>) => void;
  } = {},
) {
  const secret = authSecret.parse(env.BETTER_AUTH_SECRET);

  const previewOrigin =
    env.VERCEL_ENV === "preview" && env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined;

  const origin = originSchema.parse(env.BETTER_AUTH_URL ?? previewOrigin ?? webOrigin);
  const sender = createEmailSender(env, cloudflareEmail);

  const auth = createAuth({
    db,
    origin,
    secret,
    talent,
    staffEmails: parseStaffEmails(env.BACKOFFICE_STAFF_EMAILS),
    backofficeOrigin: env.BACKOFFICE_ORIGIN && originSchema.parse(env.BACKOFFICE_ORIGIN),
    onVercel: env.VERCEL === "1",
    ipAddressHeaders:
      ipAddressHeaders ?? (env.EMAIL_PROVIDER === "console" ? ["x-forwarded-for"] : undefined),
    async sendLink(message) {
      const delivery = sender.send(signInEmail(message));

      if (!deferMagicLinkDelivery) return delivery;

      deferMagicLinkDelivery(
        delivery.catch(() => {
          console.error({ event: "auth.magic_link_delivery_failed" });
        }),
      );
    },
    sendCode({ email, code }) {
      return sender.send(
        signInCodeEmail({ email, code, minutes: codeLifetimeSeconds / 60, origin }),
      );
    },
  });

  return { auth, origin, sender };
}
