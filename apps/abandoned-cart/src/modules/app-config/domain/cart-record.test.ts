import { describe, expect, it } from "vitest";

import { CartRecord, CartRecordInput } from "./cart-record";

const base: CartRecordInput = {
  checkoutId: "ck-1",
  saleorApiUrl: "https://example.test/graphql/",
  appId: "app-1",
  channelSlug: "global-store",
  email: "buyer@example.com",
  customerFirstName: null,
  customerLastName: null,
  totalAmount: 70.76,
  currency: "USD",
  lines: [],
  // Saleor's wire format: microsecond precision + numeric UTC offset.
  lastUpdatedAt: "2026-06-09T05:17:02.816451+00:00",
  createdAt: "2026-06-09T05:10:00.123456+00:00",
  remindersSent: [],
  recoveredAt: null,
  unsubscribedAt: null,
  ttl: 9999999999,
};

describe("CartRecord timestamp validation", () => {
  it("accepts Saleor's microsecond + offset timestamps", () => {
    const result = CartRecord.create(base);

    expect(result.isOk()).toBe(true);
  });

  it("accepts plain UTC Z timestamps too", () => {
    const result = CartRecord.create({
      ...base,
      lastUpdatedAt: "2026-06-09T05:17:02.816Z",
      createdAt: "2026-06-09T05:10:00.000Z",
    });

    expect(result.isOk()).toBe(true);
  });

  it("derives status label from the latest reminder", () => {
    const cart = CartRecord.create({
      ...base,
      remindersSent: [
        { reminderName: "First nudge", sentAt: "2026-06-09T06:00:00.000Z" },
        { reminderName: "Second nudge", sentAt: "2026-06-10T06:00:00.000Z" },
      ],
    })._unsafeUnwrap();

    expect(cart.lastReminder?.reminderName).toBe("Second nudge");
  });
});
