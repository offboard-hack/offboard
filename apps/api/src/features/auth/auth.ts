import { randomBytes } from "node:crypto";
import type { Database } from "@offboard/db/client";
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
  teamMembers,
} from "@offboard/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins/magic-link";
import { and, eq, sql } from "drizzle-orm";
import { Resend } from "resend";
import { z } from "zod";

import type { PortalAuth } from "../../shared/portal-auth.js";

const authPath = "/api/auth";
const verifyPath = "/magic-link/verify";

const browserEndpoints = new Set([
  `GET ${authPath}${verifyPath}`,
  `POST ${authPath}/sign-in/magic-link`,
  `POST ${authPath}/sign-out`,
]);

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

const emailConfig = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().min(1),
  AUTH_EMAIL_FROM: z.string().min(1),
});

const memberLinkToken = z
  .string()
  .transform((token) => token.split(".", 1)[0])
  .pipe(z.uuid());

const callbackQuery = z.object({ token: memberLinkToken });
const callbackContext = z.object({ query: callbackQuery });

export function createAuth({
  db,
  origin,
  secret,
  sendLink,
  onVercel = false,
}: {
  db: Database;
  origin: string;
  secret: string;
  sendLink: (message: { email: string; url: string }) => Promise<void>;
  onVercel?: boolean;
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

  const auth = betterAuth({
    appName: "Offboard",
    baseURL: origin,
    basePath: authPath,
    secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    trustedOrigins: [origin],
    advanced: {
      useSecureCookies: origin.startsWith("https:"),
      ipAddress: { ipAddressHeaders: onVercel ? ["x-vercel-forwarded-for"] : [] },
    },
    rateLimit: { enabled: true, storage: "database" },
    session: {
      expiresIn: 12 * 60 * 60,
      disableSessionRefresh: true,
      additionalFields: { memberId: { type: "string", required: true, input: false } },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path === verifyPath && !callbackQuery.safeParse(context.query).success) {
          throw context.redirect(`${origin}/entrar?error=INVALID_TOKEN`);
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          async before(user, context) {
            const { token: memberId } = callbackContext.parse(context).query;
            const member = await findMember(user.email, memberId);

            return member ? { data: { name: member.name } } : false;
          },
        },
      },
      session: {
        create: {
          async before(session, context) {
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
      magicLink({
        expiresIn: 10 * 60,
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

      if (!browserEndpoints.has(`${request.method} ${url.pathname}`)) {
        return new Response(null, { status: 404 });
      }

      if (request.method === "POST" && request.headers.get("origin") !== origin) {
        return new Response(null, { status: 403 });
      }

      let authRequest = request;

      if (url.pathname === `${authPath}${verifyPath}` && !url.searchParams.get("callbackURL")) {
        url.searchParams.set("callbackURL", "/");
        authRequest = new Request(url, request);
      }

      const response = await auth.handler(authRequest);
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      headers.set("referrer-policy", "no-referrer");

      return new Response(response.body, { status: response.status, headers });
    },
    async resolvePrincipal(headers) {
      const session = await auth.api.getSession({ headers });

      if (!session) return { kind: "anonymous" };

      if (!session.user.emailVerified) return { kind: "forbidden" };

      const member = await findMember(session.user.email, session.session.memberId);

      return member ? { kind: "authenticated", principal: member } : { kind: "forbidden" };
    },
  } satisfies PortalAuth;
}

export function createRuntimeAuth(db: Database, webOrigin?: string) {
  const env = emailConfig.parse(process.env);

  const previewOrigin =
    process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined;

  const origin = originSchema.parse(process.env.BETTER_AUTH_URL ?? previewOrigin ?? webOrigin);
  const resend = new Resend(env.RESEND_API_KEY);

  const auth = createAuth({
    db,
    origin,
    secret: env.BETTER_AUTH_SECRET,
    onVercel: process.env.VERCEL === "1",
    async sendLink({ email, url }) {
      const { error } = await resend.emails.send({
        from: env.AUTH_EMAIL_FROM,
        to: email,
        subject: "Seu link de acesso ao Offboard",
        text: `Entre no Offboard: ${url}\n\nO link expira em 10 minutos e só pode ser usado uma vez.`,
      });

      if (error) throw new Error("Could not send the Offboard sign-in link");
    },
  });

  return { auth, origin };
}
