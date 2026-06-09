import { describe, expect, it, vi } from "vitest";

import { AppConfig } from "@/modules/app-config/domain/app-config";
import { CartRecord } from "@/modules/app-config/domain/cart-record";
import { AbandonedCartRepoMemory } from "@/modules/app-config/repositories/repo-memory";
import { EmailSender } from "@/modules/email/email-sender";
import { createSaleorApiUrl, SaleorApiUrl } from "@/modules/saleor/saleor-api-url";

import { MarkRecoveredUseCase } from "./mark-recovered";

const SALEOR_URL: SaleorApiUrl = createSaleorApiUrl("https://example.test/graphql/")._unsafeUnwrap();
const ACCESS = { saleorApiUrl: SALEOR_URL, appId: "app-1" };

const smtp = {
  host: "smtp.ionos.com",
  port: 587,
  user: "admin@88clipon.com",
  password: "secret",
  useTls: true,
  fromEmail: "admin@88clipon.com",
  fromName: "88Clipon",
};

const trackedCart = () =>
  CartRecord.create({
    checkoutId: "ck-1",
    saleorApiUrl: SALEOR_URL,
    appId: "app-1",
    channelSlug: "default",
    email: "buyer@example.com",
    customerFirstName: "Alex",
    customerLastName: "Buyer",
    totalAmount: 70.76,
    currency: "USD",
    lines: [],
    createdAt: "2026-06-09T00:00:00.000Z",
    lastUpdatedAt: "2026-06-09T00:00:00.000Z",
    remindersSent: [{ reminderName: "First nudge", sentAt: "2026-06-09T01:00:00.000Z" }],
    recoveredAt: null,
    unsubscribedAt: null,
    ttl: 9999999999,
  })._unsafeUnwrap();

const orderPayload = {
  order: {
    number: "1042",
    checkoutId: "ck-1",
    userEmail: "buyer@example.com",
    total: { gross: { amount: 70.76, currency: "USD" } },
  },
};

async function setup(conversionNotifyEmail?: string) {
  const repo = new AbandonedCartRepoMemory();

  await repo.saveConfig({
    access: ACCESS,
    config: AppConfig.create({
      storeName: "88Clipon",
      retentionDays: 30,
      conversionNotifyEmail,
      smtp,
      programs: [],
    })._unsafeUnwrap(),
  });
  await repo.saveCart({ access: ACCESS, cart: trackedCart() });

  return repo;
}

describe("MarkRecoveredUseCase", () => {
  it("marks the cart recovered and sends a conversion notification when configured", async () => {
    // Arrange
    const repo = await setup("ops@88clipon.com");
    const send = vi.fn(async () => ({ isErr: () => false, value: { messageId: "m1" } }));
    const useCase = new MarkRecoveredUseCase(repo, { send } as unknown as EmailSender);

    // Act
    const result = await useCase.execute({ access: ACCESS, payload: orderPayload });

    // Assert
    expect(result._unsafeUnwrap()).toStrictEqual({ recovered: true, notified: true });
    expect(send).toHaveBeenCalledOnce();
    const arg = send.mock.calls[0][0] as { email: { to: string; subject: string } };

    expect(arg.email.to).toBe("ops@88clipon.com");
    expect(arg.email.subject).toBe(
      "An abandoned cart was converted to an order ($70.76 Total Value)",
    );
  });

  it("recovers without notifying when no conversion-notify email is set", async () => {
    // Arrange
    const repo = await setup(undefined);
    const send = vi.fn();
    const useCase = new MarkRecoveredUseCase(repo, { send } as unknown as EmailSender);

    // Act
    const result = await useCase.execute({ access: ACCESS, payload: orderPayload });

    // Assert — cart still recovers; only the notification is skipped.
    expect(result._unsafeUnwrap()).toStrictEqual({ recovered: true, notified: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("is a no-op for an order whose checkout was never tracked", async () => {
    // Arrange
    const repo = await setup("ops@88clipon.com");
    const send = vi.fn();
    const useCase = new MarkRecoveredUseCase(repo, { send } as unknown as EmailSender);

    // Act
    const result = await useCase.execute({
      access: ACCESS,
      payload: { order: { checkoutId: "unknown-token" } },
    });

    // Assert
    expect(result._unsafeUnwrap()).toStrictEqual({ recovered: false, notified: false });
    expect(send).not.toHaveBeenCalled();
  });
});
