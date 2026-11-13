// Small cryptographic helpers on the Web Crypto API (Workers and Node have it): Discord's request
// signatures, and the HMAC that signs the keys given to EDCH.

const encoder = new TextEncoder();

const hexBytes = (hex: string) => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16));
};

/** Bytes as URL-safe base64 without padding. */
export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** URL-safe base64 (with or without padding) as bytes; null when it isn't base64. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Discord signs each interaction (Ed25519 over timestamp + body) with the application's public
 * key: a request that isn't signed by Discord is refused before anything is read.
 */
export async function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  body: string,
): Promise<boolean> {
  const key = hexBytes(publicKeyHex);
  const signature = signatureHex ? hexBytes(signatureHex) : null;
  if (!key || !signature || !timestamp) return false;
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", cryptoKey, signature, encoder.encode(timestamp + body));
  } catch {
    return false;
  }
}

const hmacKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

/** HMAC-SHA256 of `text`, URL-safe base64. */
export async function sign(secret: string, text: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(text));
  return base64Url(new Uint8Array(signature));
}

/** Checks an HMAC made by `sign` (in constant time, by the Web Crypto API). */
export async function verifySignature(secret: string, text: string, signature: string): Promise<boolean> {
  const bytes = fromBase64Url(signature);
  if (!bytes) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), bytes, encoder.encode(text));
}
