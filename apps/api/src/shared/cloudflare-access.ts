import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

export type AccessVerifier = (token: string) => Promise<string | undefined>;

const identity = z.object({ email: z.email() });

export const denyAll: AccessVerifier = () => Promise.resolve(undefined);

export function accessVerifier(issuer: string, audience: string, keys: JWTVerifyGetKey) {
  const verify: AccessVerifier = async (token) => {
    const { payload } = await jwtVerify(token, keys, { issuer, audience });
    const parsed = identity.safeParse(payload);

    return parsed.success ? parsed.data.email : undefined;
  };

  return verify;
}

export function accessVerifierFromEnv(env: {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}) {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return denyAll;

  const issuer = `https://${env.CF_ACCESS_TEAM_DOMAIN}`;

  return accessVerifier(
    issuer,
    env.CF_ACCESS_AUD,
    createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
  );
}
