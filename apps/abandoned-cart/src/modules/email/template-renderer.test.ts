import { describe, expect, it } from "vitest";

import { CartRecord } from "@/modules/app-config/domain/cart-record";

import { buildContext, renderTemplate } from "./template-renderer";

const sampleCart = CartRecord.create({
  checkoutId: "abc",
  saleorCheckoutId: "Q2hlY2tvdXQ6YWJj",
  saleorApiUrl: "https://example.test/graphql/",
  appId: "app-1",
  channelSlug: "us",
  email: "buyer@example.com",
  customerFirstName: "Alex",
  customerLastName: "Buyer",
  totalAmount: 49.88,
  currency: "USD",
  lines: [
    { name: "Sample 50X20", quantity: 2, unitPrice: 24.94 },
  ],
  createdAt: "2026-05-25T00:00:00.000Z",
  lastUpdatedAt: "2026-05-25T01:00:00.000Z",
  remindersSent: [],
  recoveredAt: null,
  unsubscribedAt: null,
  ttl: 9999999999,
})._unsafeUnwrap();

describe("template renderer", () => {
  it("renders all standard merge variables", () => {
    const ctx = buildContext({
      cart: sampleCart,
      storefrontUrl: "https://88clipon.com",
      storeName: "88Clipon",
    });

    const html = renderTemplate(
      "<p>Hi {{customer.firstName}},</p>" +
        "<p>{{cart.itemCount}} items, total {{cart.currency}} {{cart.total}}.</p>" +
        '<p><a href="{{cart.recoveryUrl}}">Return to cart</a></p>' +
        "<p>— {{store.name}}</p>",
      ctx,
    );

    expect(html).toContain("Hi Alex");
    expect(html).toContain("2 items, total USD 49.88");
    /*
     * Recovery URL points at the top-level /checkout page with the Saleor
     * checkout global ID. Handlebars HTML-escapes `=` to `&#x3D;`; browsers
     * decode it, so the link still works for customers.
     */
    expect(html).toContain("https://88clipon.com/checkout?checkout");
    expect(html).toContain("Q2hlY2tvdXQ6YWJj");
    expect(html).toContain("— 88Clipon");
  });

  it("treats merchant-supplied discount-code text as literal", () => {
    const ctx = buildContext({
      cart: sampleCart,
      storefrontUrl: "https://88clipon.com",
      storeName: "88Clipon",
    });
    const html = renderTemplate(
      "<p>Use code <strong>COMEBACK10</strong> for 10% off.</p>",
      ctx,
    );

    expect(html).toBe("<p>Use code <strong>COMEBACK10</strong> for 10% off.</p>");
  });

  it("iterates over cart.items with {{#each}}", () => {
    const ctx = buildContext({
      cart: sampleCart,
      storefrontUrl: "https://88clipon.com",
      storeName: "88Clipon",
    });
    const html = renderTemplate(
      "<ul>{{#each cart.items}}<li>{{quantity}} × {{name}} @ {{price}}</li>{{/each}}</ul>",
      ctx,
    );

    expect(html).toBe("<ul><li>2 × Sample 50X20 @ 24.94</li></ul>");
  });
});
