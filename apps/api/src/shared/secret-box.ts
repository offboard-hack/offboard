const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

async function deriveKey(secret: string) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: encoder.encode("offboard:integrations"),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function secretBox(secret: string) {
  const key = deriveKey(secret);

  async function seal(plain: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await key,
      encoder.encode(plain),
    );

    return `${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
  }

  async function open(sealed: string) {
    const separator = sealed.indexOf(".");
    const iv = sealed.slice(0, separator);
    const data = sealed.slice(separator + 1);

    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(iv) },
        await key,
        fromBase64(data),
      );

      return decoder.decode(plain);
    } catch {
      return undefined;
    }
  }

  return { seal, open };
}

export type SecretBox = ReturnType<typeof secretBox>;
