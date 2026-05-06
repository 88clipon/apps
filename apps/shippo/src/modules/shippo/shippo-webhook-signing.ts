import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies `Shippo-Auth-Signature` per Shippo webhook security docs:
 * `t=<unix_ts>,v1=<hex_hmac>` where the signed payload is `${t}.${rawBody}`.
 */
export const verifyShippoAuthSignature = (opts: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
}): boolean => {
  if (!opts.signatureHeader || !opts.secret) return false;

  let timestamp = "";
  let v1 = "";

  for (const part of opts.signatureHeader.split(",").map((s) => s.trim())) {
    if (part.startsWith("t=")) timestamp = part.slice(2);
    else if (part.startsWith("v1=")) v1 = part.slice(3).toLowerCase();
  }

  if (!timestamp || !v1) return false;

  const signedPayload = `${timestamp}.${opts.rawBody}`;
  const expected = createHmac("sha256", opts.secret).update(signedPayload).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");

  if (a.length !== b.length) return false;

  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
};
