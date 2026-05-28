import { describe, expect, it } from "vitest";

import { AppConfig } from "@/modules/app-config/domain/app-config";
import { CartRecord, CartRecordInput } from "@/modules/app-config/domain/cart-record";

import { decideNextAction } from "./reminder-decider";

const baseConfig = (): AppConfig =>
  AppConfig.create({
    storeName: "Store",
    retentionDays: 30,
    programs: [
      {
        channelSlug: "default",
        enabled: true,
        perEmailThrottleHours: 24,
        reminders: [
          { name: "r1", hoursAfterLastActivity: 1, subject: "s", bodyHtml: "b" },
          { name: "r2", hoursAfterLastActivity: 24, subject: "s", bodyHtml: "b" },
        ],
      },
    ],
  })._unsafeUnwrap();

const cart = (overrides: Partial<CartRecordInput> = {}): CartRecord =>
  CartRecord.create({
    checkoutId: "ck-1",
    saleorApiUrl: "https://example.test/graphql/",
    appId: "app-1",
    channelSlug: "default",
    email: "buyer@example.com",
    customerFirstName: "Alex",
    customerLastName: "B",
    totalAmount: 50,
    currency: "USD",
    lines: [],
    createdAt: "2026-05-25T00:00:00.000Z",
    lastUpdatedAt: "2026-05-25T00:00:00.000Z",
    remindersSent: [],
    recoveredAt: null,
    unsubscribedAt: null,
    ttl: 9999999999,
    ...overrides,
  })._unsafeUnwrap();

describe("decideNextAction", () => {
  it("sends the first reminder when the schedule has elapsed", () => {
    const decision = decideNextAction({
      cart: cart(),
      config: baseConfig(),
      now: new Date("2026-05-25T01:30:00.000Z"),
      latestSendToEmailAt: null,
    });

    expect(decision).toStrictEqual({
      kind: "send",
      reminder: { name: "r1", hoursAfterLastActivity: 1, subject: "s", bodyHtml: "b" },
    });
  });

  it("skips when the first reminder isn't due yet", () => {
    const decision = decideNextAction({
      cart: cart(),
      config: baseConfig(),
      now: new Date("2026-05-25T00:30:00.000Z"),
      latestSendToEmailAt: null,
    });

    expect(decision).toStrictEqual({ kind: "skip", reason: "next-reminder-not-due-yet" });
  });

  it("moves to the second reminder once the first is sent and 24h have elapsed", () => {
    const decision = decideNextAction({
      cart: cart({
        remindersSent: [{ reminderName: "r1", sentAt: "2026-05-25T01:30:00.000Z" }],
      }),
      config: baseConfig(),
      now: new Date("2026-05-26T02:00:00.000Z"), // 24.5h after the last send → clears the 24h throttle
      latestSendToEmailAt: "2026-05-25T01:30:00.000Z",
    });

    expect(decision).toStrictEqual({
      kind: "send",
      reminder: { name: "r2", hoursAfterLastActivity: 24, subject: "s", bodyHtml: "b" },
    });
  });

  it("throttles when the same address received a reminder in the last 24h", () => {
    const decision = decideNextAction({
      cart: cart(),
      config: baseConfig(),
      now: new Date("2026-05-25T02:00:00.000Z"),
      latestSendToEmailAt: "2026-05-25T01:30:00.000Z",
    });

    expect(decision).toStrictEqual({ kind: "skip", reason: "throttled" });
  });

  it("skips when recovered", () => {
    const decision = decideNextAction({
      cart: cart({ recoveredAt: "2026-05-25T00:30:00.000Z" }),
      config: baseConfig(),
      now: new Date("2026-05-26T00:00:00.000Z"),
      latestSendToEmailAt: null,
    });

    expect(decision).toStrictEqual({ kind: "skip", reason: "not-live" });
  });

  it("skips when no email is captured on the checkout", () => {
    const decision = decideNextAction({
      cart: cart({ email: null }),
      config: baseConfig(),
      now: new Date("2026-05-26T00:00:00.000Z"),
      latestSendToEmailAt: null,
    });

    expect(decision).toStrictEqual({ kind: "skip", reason: "not-live" });
  });

  it("skips when channel has no enabled program", () => {
    const decision = decideNextAction({
      cart: cart({ channelSlug: "other" }),
      config: baseConfig(),
      now: new Date("2026-05-26T00:00:00.000Z"),
      latestSendToEmailAt: null,
    });

    expect(decision).toStrictEqual({ kind: "skip", reason: "no-program" });
  });

  it("skips when all reminders have already been sent", () => {
    const decision = decideNextAction({
      cart: cart({
        remindersSent: [
          { reminderName: "r1", sentAt: "2026-05-25T01:30:00.000Z" },
          { reminderName: "r2", sentAt: "2026-05-26T01:30:00.000Z" },
        ],
      }),
      config: baseConfig(),
      now: new Date("2026-06-01T00:00:00.000Z"),
      latestSendToEmailAt: "2026-05-26T01:30:00.000Z",
    });

    expect(decision).toStrictEqual({ kind: "skip", reason: "all-reminders-sent" });
  });
});
