import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  signShippingEasyRequest,
  verifyShippingEasyWebhookSignature,
} from "./shippingeasy-signing";

describe("signShippingEasyRequest", () => {
  it("produces a base64 HMAC-SHA256 signature of METHOD&path&query", () => {
    const result = signShippingEasyRequest({
      method: "GET",
      path: "/stores.json",
      apiKey: "key-123",
      apiSecret: "secret-abc",
      timestampSeconds: 1_700_000_000,
    });

    const canonicalQuery = `api_key=${encodeURIComponent("key-123")}&api_timestamp=1700000000`;
    const expected = crypto
      .createHmac("sha256", "secret-abc")
      .update(`GET&${encodeURIComponent("/stores.json")}&${encodeURIComponent(canonicalQuery)}`)
      .digest("base64");

    expect(result.apiSignature).toBe(expected);
    expect(result.queryParams.api_signature).toBe(expected);
    expect(result.queryParams.api_key).toBe("key-123");
    expect(result.queryParams.api_timestamp).toBe("1700000000");
  });

  it("sorts additional params alphabetically before signing", () => {
    const a = signShippingEasyRequest({
      method: "POST",
      path: "/rates.json",
      apiKey: "k",
      apiSecret: "s",
      timestampSeconds: 1,
      additionalParams: { page: "2", limit: "50" },
    });
    const b = signShippingEasyRequest({
      method: "POST",
      path: "/rates.json",
      apiKey: "k",
      apiSecret: "s",
      timestampSeconds: 1,
      additionalParams: { limit: "50", page: "2" },
    });

    expect(a.apiSignature).toBe(b.apiSignature);
  });
});

describe("verifyShippingEasyWebhookSignature", () => {
  const apiSecret = "webhook-secret";
  const rawBody = JSON.stringify({ event: "label.created", data: { order_id: "42" } });
  const validSignature = crypto
    .createHmac("sha256", apiSecret)
    .update(rawBody)
    .digest("base64");

  it("returns true for a matching signature", () => {
    expect(
      verifyShippingEasyWebhookSignature({
        apiSecret,
        rawBody,
        signatureHeader: validSignature,
      }),
    ).toBe(true);
  });

  it("returns false for a mismatched signature", () => {
    expect(
      verifyShippingEasyWebhookSignature({
        apiSecret,
        rawBody,
        signatureHeader: "bogus==",
      }),
    ).toBe(false);
  });

  it("returns false when the signature header is missing", () => {
    expect(
      verifyShippingEasyWebhookSignature({
        apiSecret,
        rawBody,
        signatureHeader: null,
      }),
    ).toBe(false);
  });
});
