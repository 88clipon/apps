import { err, ok, Result, ResultAsync } from "neverthrow";
import { z } from "zod";

import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

import { ShippingEasyApiError, ShippingEasyApiErrorInstance } from "./shippingeasy-errors";
import {
  ShippingEasyAddress,
  shippingEasyOrderCreateResponseSchema,
  shippingEasyRatesResponseSchema,
  shippingEasyStoresResponseSchema,
} from "./shippingeasy-schemas";
import { signShippingEasyRequest } from "./shippingeasy-signing";

const logger = createLogger("ShippingEasyClient");

export type ShippingEasyCredentials = {
  apiKey: string;
  apiSecret: string;
  storeId: string;
};

export type ShippingEasyClientConfig = {
  credentials: ShippingEasyCredentials;
  baseUrl: string;
  /** Per-request timeout in milliseconds. Defaults to 10_000. */
  timeoutMs?: number;
};

export type RateRequestPackage = {
  weightOunces: number;
  lengthInches?: number;
  widthInches?: number;
  heightInches?: number;
};

export type RateRequest = {
  toAddress: ShippingEasyAddress;
  fromAddress: ShippingEasyAddress;
  package: RateRequestPackage;
  /** Declared customs value in USD, used for international shipments. */
  declaredValue?: number;
  /** Carrier allowlist (e.g. ["usps", "ups"]). Undefined returns all configured carriers. */
  carriers?: readonly string[];
};

export type OrderCreateInput = {
  externalOrderIdentifier: string;
  orderedAt: string;
  totalIncludingTax: number;
  currency: string;
  shippingAddress: ShippingEasyAddress;
  billingAddress?: ShippingEasyAddress;
  items: ReadonlyArray<{
    sku?: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  /** Ask ShippingEasy to send shipment confirmation / tracking emails. */
  sendEmails: boolean;
};

export class ShippingEasyClient {
  private readonly credentials: ShippingEasyCredentials;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ShippingEasyClientConfig) {
    this.credentials = config.credentials;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  private async request<TSchema extends z.ZodType>(args: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    body?: unknown;
    schema: TSchema;
    /** Optional per-call timeout override (e.g. tight budget during checkout). */
    timeoutMs?: number;
  }): Promise<Result<z.infer<TSchema>, ShippingEasyApiErrorInstance>> {
    const { method, path, body, schema } = args;
    const timeoutMs = args.timeoutMs ?? this.timeoutMs;

    const signed = signShippingEasyRequest({
      method,
      path,
      apiKey: this.credentials.apiKey,
      apiSecret: this.credentials.apiSecret,
    });

    const url = new URL(`${this.baseUrl}${path}`);

    for (const [k, v] of Object.entries(signed.queryParams)) {
      url.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const rawText = await response.text();

      if (!response.ok) {
        return err(this.mapHttpError(response.status, rawText));
      }

      let parsedJson: unknown;

      try {
        parsedJson = rawText.length > 0 ? JSON.parse(rawText) : {};
      } catch (cause) {
        return err(
          new ShippingEasyApiError.InvalidResponse("ShippingEasy returned non-JSON response", {
            cause,
          }),
        );
      }

      const parseResult = schema.safeParse(parsedJson);

      if (!parseResult.success) {
        logger.warn("ShippingEasy response shape mismatch", {
          issues: parseResult.error.issues,
        });

        return err(
          new ShippingEasyApiError.InvalidResponse("ShippingEasy response failed validation", {
            cause: parseResult.error,
          }),
        );
      }

      return ok(parseResult.data);
    } catch (cause) {
      if ((cause as Error | undefined)?.name === "AbortError") {
        return err(
          new ShippingEasyApiError.Timeout(
            `ShippingEasy request timed out after ${timeoutMs}ms`,
            { cause },
          ),
        );
      }

      return err(
        new ShippingEasyApiError.NetworkError("ShippingEasy network error", { cause }),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private mapHttpError(status: number, body: string): ShippingEasyApiErrorInstance {
    const base = { cause: new BaseError(body.slice(0, 500)) };

    if (status === 401 || status === 403) {
      return new ShippingEasyApiError.Unauthorized(`ShippingEasy auth failed (${status})`, base);
    }
    if (status === 404) {
      return new ShippingEasyApiError.NotFound(`ShippingEasy resource not found`, base);
    }
    if (status === 429) {
      return new ShippingEasyApiError.RateLimited(`ShippingEasy rate-limited`, base);
    }
    if (status >= 500) {
      return new ShippingEasyApiError.ServerError(`ShippingEasy server error (${status})`, base);
    }

    return new ShippingEasyApiError.BadRequest(`ShippingEasy bad request (${status})`, base);
  }

  /**
   * Verify credentials are valid. Used by the "Test Connection" button in config UI.
   */
  listStores() {
    return this.request({
      method: "GET",
      path: "/stores.json",
      schema: shippingEasyStoresResponseSchema,
    });
  }

  /**
   * POST /rates.json - returns available carrier rates for the given cart.
   */
  getRates(input: RateRequest, opts?: { timeoutMs?: number }) {
    return this.request({
      method: "POST",
      path: "/rates.json",
      schema: shippingEasyRatesResponseSchema,
      timeoutMs: opts?.timeoutMs,
      body: {
        rate: {
          to_address: input.toAddress,
          from_address: input.fromAddress,
          parcel: {
            weight_in_ounces: input.package.weightOunces,
            length: input.package.lengthInches,
            width: input.package.widthInches,
            height: input.package.heightInches,
          },
          declared_value: input.declaredValue,
          carriers: input.carriers,
        },
      },
    });
  }

  /**
   * POST /stores/:id/orders.json - pushes a Saleor order into ShippingEasy for
   * fulfillment.
   */
  createOrder(input: OrderCreateInput) {
    return this.request({
      method: "POST",
      path: `/stores/${encodeURIComponent(this.credentials.storeId)}/orders.json`,
      schema: shippingEasyOrderCreateResponseSchema,
      body: {
        orders: [
          {
            external_order_identifier: input.externalOrderIdentifier,
            ordered_at: input.orderedAt,
            total_including_tax: input.totalIncludingTax,
            currency: input.currency,
            send_shipment_confirmation_email: input.sendEmails,
            send_tracking_email: input.sendEmails,
            recipients: [
              {
                recipient: {
                  address: input.shippingAddress,
                  billing_address: input.billingAddress ?? input.shippingAddress,
                  order_items: input.items.map((item) => ({
                    sku: item.sku,
                    name: item.name,
                    quantity: item.quantity,
                    unit_price: item.unitPrice,
                  })),
                },
              },
            ],
          },
        ],
      },
    });
  }

  /**
   * DELETE /stores/:id/orders/:externalOrderId.json - cancel an order that
   * hasn't been shipped yet.
   */
  cancelOrder(externalOrderIdentifier: string) {
    return this.request({
      method: "DELETE",
      path: `/stores/${encodeURIComponent(
        this.credentials.storeId,
      )}/orders/${encodeURIComponent(externalOrderIdentifier)}.json`,
      schema: z.object({ success: z.boolean().optional() }).passthrough(),
    });
  }
}

/**
 * Wrap any thrown error from the client in a Result so callers don't need to
 * guard against unexpected exceptions.
 */
export const safeListStores = (client: ShippingEasyClient) =>
  ResultAsync.fromPromise(
    client.listStores(),
    (cause) =>
      new ShippingEasyApiError.NetworkError("Unexpected ShippingEasy client error", { cause }),
  ).andThen((r) => r);
