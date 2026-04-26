import crypto from "node:crypto";

/**
 * ShippingEasy signs outbound API requests with an HMAC-SHA256 digest over:
 *   {HTTP_METHOD}&{URL_ENCODED_PATH}&{URL_ENCODED_SORTED_PARAMS}
 * and encodes the digest in base64. The signature is passed as the `api_signature`
 * query parameter alongside `api_key` and `api_timestamp`.
 *
 * See https://app.shippingeasy.com/api_docs for details.
 */

export type ShippingEasySignatureInput = {
  method: string;
  path: string;
  apiKey: string;
  apiSecret: string;
  timestampSeconds?: number;
  /** Additional query params (not including api_key/api_timestamp). */
  additionalParams?: Record<string, string | number | undefined>;
};

export type ShippingEasySignatureOutput = {
  apiSignature: string;
  apiTimestamp: string;
  /** Fully built query string params, including api_key, api_timestamp and signature. */
  queryParams: Record<string, string>;
};

const toQueryString = (params: Record<string, string>): string => {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] ?? "")}`)
    .join("&");
};

export const signShippingEasyRequest = (
  input: ShippingEasySignatureInput,
): ShippingEasySignatureOutput => {
  const timestamp = String(input.timestampSeconds ?? Math.floor(Date.now() / 1000));

  const params: Record<string, string> = {
    api_key: input.apiKey,
    api_timestamp: timestamp,
  };

  if (input.additionalParams) {
    for (const [k, v] of Object.entries(input.additionalParams)) {
      if (v === undefined) continue;
      params[k] = String(v);
    }
  }

  const canonicalQuery = toQueryString(params);
  const message = [
    input.method.toUpperCase(),
    encodeURIComponent(input.path),
    encodeURIComponent(canonicalQuery),
  ].join("&");

  const apiSignature = crypto
    .createHmac("sha256", input.apiSecret)
    .update(message)
    .digest("base64");

  return {
    apiSignature,
    apiTimestamp: timestamp,
    queryParams: {
      ...params,
      api_signature: apiSignature,
    },
  };
};

/**
 * ShippingEasy signs inbound webhooks with the same HMAC-SHA256/base64 scheme
 * but over the raw request body, using the store's api_secret.
 * The signature is sent in the `X-SE-Signature` header.
 */
export const verifyShippingEasyWebhookSignature = ({
  apiSecret,
  rawBody,
  signatureHeader,
}: {
  apiSecret: string;
  rawBody: string;
  signatureHeader: string | null | undefined;
}): boolean => {
  if (!signatureHeader) return false;

  const expected = crypto.createHmac("sha256", apiSecret).update(rawBody).digest("base64");

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signatureHeader);

  if (expectedBuf.length !== receivedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
};
