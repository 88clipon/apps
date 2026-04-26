import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ShippingEasyClient } from "./shippingeasy-client";

const BASE = "https://example.shippingeasy.test/api";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const makeClient = () =>
  new ShippingEasyClient({
    baseUrl: BASE,
    credentials: { apiKey: "k", apiSecret: "s", storeId: "99" },
  });

describe("ShippingEasyClient", () => {
  it("lists stores and parses the response", async () => {
    server.use(
      http.get(`${BASE}/stores.json`, () =>
        HttpResponse.json({
          stores: [
            { id: 1, name: "Primary", platform: "saleor" },
            { id: "2", name: "Secondary" },
          ],
        }),
      ),
    );

    const result = await makeClient().listStores();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.stores).toHaveLength(2);
      expect(result.value.stores[0].id).toBe("1");
    }
  });

  it("returns Unauthorized error on 401", async () => {
    server.use(http.get(`${BASE}/stores.json`, () => new HttpResponse(null, { status: 401 })));

    const result = await makeClient().listStores();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._internalName).toBe("ShippingEasyApiError.Unauthorized");
    }
  });

  it("maps 5xx to ServerError", async () => {
    server.use(http.get(`${BASE}/stores.json`, () => new HttpResponse(null, { status: 502 })));

    const result = await makeClient().listStores();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._internalName).toBe("ShippingEasyApiError.ServerError");
    }
  });

  it("returns InvalidResponse when schema does not match", async () => {
    server.use(
      http.get(`${BASE}/stores.json`, () => HttpResponse.json({ not_stores: true })),
    );

    const result = await makeClient().listStores();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._internalName).toBe("ShippingEasyApiError.InvalidResponse");
    }
  });

  it("posts rates and returns a list", async () => {
    server.use(
      http.post(`${BASE}/rates.json`, () =>
        HttpResponse.json({
          rates: [
            {
              id: "usps-priority",
              carrier: "usps",
              service: "priority",
              rate: 8.5,
              currency: "USD",
              estimated_delivery_days_min: 1,
              estimated_delivery_days_max: 3,
            },
          ],
        }),
      ),
    );

    const result = await makeClient().getRates({
      toAddress: {
        street1: "1 Infinite Loop",
        city: "Cupertino",
        state: "CA",
        postal_code: "95014",
        country: "US",
      },
      fromAddress: {
        street1: "500 Terry Francois",
        city: "San Francisco",
        state: "CA",
        postal_code: "94158",
        country: "US",
      },
      package: { weightOunces: 16 },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.rates[0].carrier).toBe("usps");
      expect(result.value.rates[0].rate).toBe(8.5);
    }
  });

  it("creates an order with sendEmails flag", async () => {
    let captured: unknown;

    server.use(
      http.post(`${BASE}/stores/99/orders.json`, async ({ request }) => {
        captured = await request.json();

        return HttpResponse.json({
          order: { id: 77, external_order_identifier: "saleor-1", status: "pending" },
        });
      }),
    );

    const result = await makeClient().createOrder({
      externalOrderIdentifier: "saleor-1",
      orderedAt: "2026-01-01T00:00:00Z",
      totalIncludingTax: 19.99,
      currency: "USD",
      shippingAddress: {
        street1: "1 Infinite Loop",
        city: "Cupertino",
        state: "CA",
        postal_code: "95014",
        country: "US",
      },
      items: [{ name: "Clip-on shades", quantity: 1, unitPrice: 19.99, sku: "cs-1" }],
      sendEmails: true,
    });

    expect(result.isOk()).toBe(true);
    expect(captured).toMatchObject({
      orders: [
        {
          external_order_identifier: "saleor-1",
          send_shipment_confirmation_email: true,
          send_tracking_email: true,
        },
      ],
    });
  });
});
