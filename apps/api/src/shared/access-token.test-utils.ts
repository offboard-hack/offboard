import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";

export const issuer = "https://offboard-test.cloudflareaccess.com";
export const audience = "test-audience";

export async function accessKeys() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "ES256", use: "sig" };
  const keys: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });

  return {
    keys,
    sign({ email, aud = audience, exp }: { email?: string; aud?: string; exp?: number }) {
      const token = new SignJWT(email === undefined ? {} : { email })
        .setProtectedHeader({ alg: "ES256", kid: "test" })
        .setIssuer(issuer)
        .setAudience(aud)
        .setIssuedAt();

      return (
        exp === undefined ? token.setExpirationTime("5m") : token.setExpirationTime(exp)
      ).sign(privateKey);
    },
  };
}
