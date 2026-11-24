import { AsyncLocalStorage } from "node:async_hooks";
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
import { z } from "zod";

import type { PortalAuth, TalentPrincipal } from "../../shared/portal-auth.js";
import { createEmailSender, type CloudflareEmailBinding } from "./email.js";

const authPath = "/api/auth";
const verifyPath = "/magic-link/verify";
const signInPath = `${authPath}/sign-in/magic-link`;

type Audience = "member" | "talent";

const audienceScope = new AsyncLocalStorage<Audience>();
const audiences = { m: "member", t: "talent" } as const;
const tokenPrefixes = { member: "m", talent: "t" } as const;

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

const authSecret = z.string().min(32);

const linkToken = z
  .string()
  .transform((token) => token.split("."))
  .pipe(z.tuple([z.enum(["m", "t"]), z.uuid(), z.string().min(1)]))
  .transform(([prefix, id]) => ({ audience: audiences[prefix], id }));

const callbackQuery = z.object({ token: linkToken });
const callbackContext = z.object({ query: callbackQuery });

const sessionAudience = z.union([
  z
    .object({ talentProfileId: z.string() })
    .transform(({ talentProfileId }) => ({ audience: "talent" as const, id: talentProfileId })),
  z
    .object({ memberId: z.string() })
    .transform(({ memberId }) => ({ audience: "member" as const, id: memberId })),
]);

const appCallback = z.object({ callbackURL: z.string().regex(/^\/app(?:[/?]|$)/) });
const talentSession = z.object({ talentProfileId: z.string() });

type TalentDirectory = {
  findForSignIn(email: string, id?: string): Promise<{ id: string; name: string } | undefined>;
  markSignedIn(id: string): Promise<void>;
  findById(id: string): Promise<TalentPrincipal | undefined>;
};

async function requestAudience(request: Request, pathname: string) {
  if (pathname !== signInPath) return "member";

  const body = await request
    .clone()
    .json()
    .catch(() => undefined);

  return appCallback.safeParse(body).success ? "talent" : "member";
}

export function createAuth({
  db,
  origin,
  secret,
  talent,
  sendLink,
  onVercel = false,
  ipAddressHeaders = onVercel ? ["x-vercel-forwarded-for"] : [],
}: {
  db: Database;
  origin: string;
  secret: string;
  talent: TalentDirectory;
  sendLink: (message: { email: string; url: string }) => Promise<void>;
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

  const invitees = {
    member: findMember,
    talent: (email: string, id?: string) => talent.findForSignIn(email, id),
  };

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
        talentProfileId: { type: "string", required: false, input: false },
      },
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
            const { audience, id } = callbackContext.parse(context).query.token;
            const invitee = await invitees[audience](user.email, id);

            return invitee ? { data: { name: invitee.name } } : false;
          },
        },
      },
      session: {
        create: {
          async before(session, context) {
            const { audience, id } = callbackContext.parse(context).query.token;

            const [user] = await db
              .select({ email: authUser.email })
              .from(authUser)
              .where(and(eq(authUser.id, session.userId), eq(authUser.emailVerified, true)));

            const invitee = await invitees[audience](user.email, id);

            if (!invitee) return false;

            return {
              data:
                audience === "member" ? { memberId: invitee.id } : { talentProfileId: invitee.id },
            };
          },
          async after(session) {
            const created = talentSession.safeParse(session);

            if (created.success) await talent.markSignedIn(created.data.talentProfileId);
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        storeToken: "hashed",
        async generateToken(email) {
          const audience = audienceScope.getStore() === "talent" ? "talent" : "member";
          const invitee = await invitees[audience](email);

          return `${tokenPrefixes[audience]}.${invitee?.id ?? "uninvited"}.${randomBytes(32).toString("base64url")}`;
        },
        async sendMagicLink({ email, token, url }) {
          const link = linkToken.safeParse(token);

          if (link.success && (await invitees[link.data.audience](email, link.data.id))) {
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

      const audience = await requestAudience(request, url.pathname);
      const response = await audienceScope.run(audience, () => auth.handler(authRequest));
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      headers.set("referrer-policy", "no-referrer");

      return new Response(response.body, { status: response.status, headers });
    },
    async resolvePrincipal(headers) {
      const session = await auth.api.getSession({ headers });

      if (!session) return { kind: "anonymous" };

      if (!session.user.emailVerified) return { kind: "forbidden" };

      const { audience, id } = sessionAudience.parse(session.session);
      const email = session.user.email.toLowerCase();

      if (audience === "talent") {
        const profile = await talent.findById(id);

        return profile?.email.toLowerCase() === email
          ? {
              kind: "talent",
              profile: { id: profile.id, name: profile.name, email: profile.email },
            }
          : { kind: "forbidden" };
      }

      const member = await findMember(email, id);

      return member ? { kind: "authenticated", principal: member } : { kind: "forbidden" };
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
    talent,
    onVercel: env.VERCEL === "1",
    ipAddressHeaders,
    sendLink({ email, url }) {
      return sender.send({
        to: email,
        subject: "Seu link de acesso ao Offboard",
        text: `Entre no Offboard: ${url}\n\nO link expira em 10 minutos e só pode ser usado uma vez.`,
      });
    },
  });

  return { auth, origin, sender };
}
