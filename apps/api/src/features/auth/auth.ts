import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes } from "node:crypto";
import type { Database } from "@offboard/db/client";
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
  employeeAccess,
  offboardingCases,
  teamMembers,
} from "@offboard/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { magicLink } from "better-auth/plugins/magic-link";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { PortalAuth } from "../../shared/portal-auth.js";
import { isEmployeeApp } from "../../shared/employee-auth.js";
import { createEmailSender, type CloudflareEmailBinding } from "./email.js";
import { signInEmail, signInLinkMinutes } from "./sign-in-email.js";

const authPath = "/api/auth";
const verifyPath = "/magic-link/verify";
const codeRequestPath = "/email-otp/send-verification-otp";
const codeSignInPath = "/sign-in/email-otp";
const codeLifetimeSeconds = 10 * 60;

const browserEndpoints = new Set([
  `GET ${authPath}${verifyPath}`,
  `POST ${authPath}/sign-in/magic-link`,
  `POST ${authPath}/sign-out`,
  `POST ${authPath}${codeRequestPath}`,
  `POST ${authPath}${codeSignInPath}`,
]);

const nativeEndpoints = new Set([codeRequestPath, codeSignInPath, "/sign-out"]);

const memberFields = {
  id: teamMembers.id,
  name: teamMembers.name,
  email: teamMembers.email,
  role: teamMembers.role,
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

const memberLinkToken = z
  .string()
  .transform((token) => token.split(".", 1)[0])
  .pipe(z.uuid());

const callbackQuery = z.object({ token: memberLinkToken });
const callbackContext = z.object({ query: callbackQuery });
const otpEmail = z.object({ email: z.email().transform((email) => email.toLowerCase()) });

export function createAuth({
  db,
  origin,
  secret,
  sendLink,
  sendCode,
  onVercel = false,
  ipAddressHeaders = onVercel ? ["x-vercel-forwarded-for"] : [],
}: {
  db: Database;
  origin: string;
  secret: string;
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
      .where(
        and(
          eq(normalizedEmail, email.toLowerCase()),
          memberId ? eq(teamMembers.id, memberId) : undefined,
        ),
      );

    return member;
  }

  const normalizedEmployeeEmail = sql<string>`lower(${employeeAccess.email})`;

  const employeeOtp = new AsyncLocalStorage<{
    grant: Awaited<ReturnType<typeof findEmployee>>;
  }>();

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

  function requireOtpGrant() {
    const grant = employeeOtp.getStore()?.grant;

    if (!grant) throw new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "Invalid OTP" });

    return grant;
  }

  async function finalizeEmployeeSession() {
    const grant = requireOtpGrant();

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

  const auth = betterAuth({
    appName: "Offboard",
    baseURL: origin,
    basePath: authPath,
    secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    trustedOrigins: [origin],
    advanced: {
      useSecureCookies: origin.startsWith("https:"),
      ipAddress: { ipAddressHeaders },
    },
    rateLimit: { enabled: true, storage: "database" },
    session: {
      expiresIn: 12 * 60 * 60,
      disableSessionRefresh: true,
      additionalFields: {
        memberId: { type: "string", required: false, input: false },
        employeeCaseId: { type: "string", required: false, input: false },
        employeeGrantId: { type: "string", required: false, input: false },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path === verifyPath && !callbackQuery.safeParse(context.query).success) {
          throw context.redirect(`${origin}/entrar?error=INVALID_TOKEN`);
        }

        if (context.path === codeRequestPath || context.path === codeSignInPath) {
          const scope = employeeOtp.getStore();
          const parsed = otpEmail.safeParse(context.body);

          if (scope && parsed.success) scope.grant = await findEmployee(parsed.data.email);
        }

        if (context.path === codeSignInPath) requireOtpGrant();
      }),
    },
    databaseHooks: {
      user: {
        create: {
          async before(user, context) {
            if (context?.path === codeSignInPath) {
              const grant = requireOtpGrant();

              return { data: { name: grant.name, image: null } };
            }

            const { token: memberId } = callbackContext.parse(context).query;
            const member = await findMember(user.email, memberId);

            return member ? { data: { name: member.name } } : false;
          },
        },
      },
      session: {
        create: {
          async before(session, context) {
            if (context?.path === codeSignInPath) {
              const grant = requireOtpGrant();

              return { data: { employeeCaseId: grant.caseId, employeeGrantId: grant.grantId } };
            }

            const { token: memberId } = callbackContext.parse(context).query;

            const [member] = await db
              .select({ id: teamMembers.id })
              .from(authUser)
              .innerJoin(teamMembers, eq(normalizedEmail, authUser.email))
              .where(
                and(
                  eq(authUser.id, session.userId),
                  eq(teamMembers.id, memberId),
                  eq(authUser.emailVerified, true),
                ),
              );

            return member ? { data: { memberId: member.id } } : false;
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
            const grantId = employeeOtp.getStore()?.grant?.grantId ?? "unassigned";

            return createHmac("sha256", secret)
              .update(`offboard:employee-otp:${grantId}:${otp}`)
              .digest("hex");
          },
        },
        async sendVerificationOTP({ email, otp, type }) {
          const grant = employeeOtp.getStore()?.grant;

          if (type === "sign-in" && sendCode && grant && (await findEmployee(email, grant))) {
            await sendCode({ email, code: otp });
          }
        },
      }),
      magicLink({
        expiresIn: signInLinkMinutes * 60,
        storeToken: "hashed",
        async generateToken(email) {
          const member = await findMember(email);

          return `${member?.id ?? "uninvited"}.${randomBytes(32).toString("base64url")}`;
        },
        async sendMagicLink({ email, token, url }) {
          const memberId = memberLinkToken.safeParse(token);

          if (memberId.success && (await findMember(email, memberId.data))) {
            await sendLink({ email, url });
          }
        },
      }),
    ],
  });

  return {
    async handler(request) {
      const url = new URL(request.url);
      const path = url.pathname.slice(authPath.length);

      if (!browserEndpoints.has(`${request.method} ${url.pathname}`)) {
        return new Response(null, { status: 404 });
      }

      const native = nativeEndpoints.has(path) && isEmployeeApp(request, origin);

      if (request.method === "POST" && request.headers.get("origin") !== origin && !native) {
        return new Response(null, { status: 403 });
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

      const response = await employeeOtp.run({ grant: null }, async () => {
        const result = await auth.handler(authRequest);

        if (path === codeSignInPath && result.ok && !(await finalizeEmployeeSession())) {
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
      const session = await auth.api.getSession({ headers });

      if (!session) return { kind: "anonymous" };

      if (!session.user.emailVerified || !session.session.memberId) return { kind: "forbidden" };

      const member = await findMember(session.user.email, session.session.memberId);

      return member ? { kind: "authenticated", principal: member } : { kind: "forbidden" };
    },
    async resolveEmployee(headers) {
      const session = await auth.api.getSession({ headers });

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
  webOrigin?: string,
  {
    env = process.env,
    ipAddressHeaders,
    cloudflareEmail,
  }: {
    env?: Record<string, string | undefined>;
    ipAddressHeaders?: string[];
    cloudflareEmail?: CloudflareEmailBinding;
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
    onVercel: env.VERCEL === "1",
    ipAddressHeaders,
    sendLink(message) {
      return sender.send(signInEmail(message));
    },
    sendCode({ email, code }) {
      const text = `Seu código para entrar no Offboard é ${code}. Ele expira em ${codeLifetimeSeconds / 60} minutos.`;

      return sender.send({
        to: email,
        subject: "Seu código de acesso ao Offboard",
        text,
        html: `<p>${text}</p>`,
      });
    },
  });

  return { auth, origin };
}
