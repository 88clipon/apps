import { describe, expect, it } from "vitest";

import { extractShippoRateObjectId } from "./push-order-to-shippo";

describe("extractShippoRateObjectId", () => {
  it("parses rate id from app-style shipping method id", () => {
    expect(extractShippoRateObjectId("shippo-abc012def34567890123456789012ab")).toBe(
      "abc012def34567890123456789012ab",
    );
  });

  it("finds token when embedded in a longer id string", () => {
    expect(extractShippoRateObjectId("channel-us:shippo-deadbeef1234567890abcdef12")).toBe(
      "deadbeef1234567890abcdef12",
    );
  });
  it("returns null when missing", () => {
    expect(extractShippoRateObjectId(null)).toBeNull();
    expect(extractShippoRateObjectId("fedex_ground")).toBeNull();
  });
});
