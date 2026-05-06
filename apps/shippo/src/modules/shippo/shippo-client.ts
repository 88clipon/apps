import { err, ok, Result } from "neverthrow";
import { z } from "zod";

import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ShippoClient");

const SHIPPO_API_BASE = "https://api.goshippo.com";

/**
 * Shippo often returns no rates when only weight is sent. Merchant config may
 * omit dimensions; these defaults match a small retail parcel so rating works.
 */
const DEFAULT_PARCEL_LENGTH_IN = 6;
const DEFAULT_PARCEL_WIDTH_IN = 4;
const DEFAULT_PARCEL_HEIGHT_IN = 2;

export const ShippoApiError = {
  NetworkError: BaseError.subclass("ShippoNetworkError", {
    props: { _internalName: "ShippoApiError.NetworkError" as const },
  }),
  Timeout: BaseError.subclass("ShippoTimeoutError", {
    props: { _internalName: "ShippoApiError.Timeout" as const },
  }),
  Unauthorized: BaseError.subclass("ShippoUnauthorizedError", {
    props: { _internalName: "ShippoApiError.Unauthorized" as const },
  }),
  BadRequest: BaseError.subclass("ShippoBadRequestError", {
    props: { _internalName: "ShippoApiError.BadRequest" as const },
  }),
  ServerError: BaseError.subclass("ShippoServerError", {
    props: { _internalName: "ShippoApiError.ServerError" as const },
  }),
  InvalidResponse: BaseError.subclass("ShippoInvalidResponseError", {
    props: { _internalName: "ShippoApiError.InvalidResponse" as const },
  }),
};
export type ShippoApiErrorInstance = InstanceType<
  (typeof ShippoApiError)[keyof typeof ShippoApiError]
>;

const shippoRateSchema = z.object({
  object_id: z.string(),
  provider: z.string(),
  amount: z.coerce.number(),
  currency: z.string(),
  servicelevel: z.object({
    name: z.string(),
    token: z.string(),
    terms: z.string().optional().nullable(),
  }),
  estimated_days: z.number().optional().nullable(),
  arrives_by: z.string().optional().nullable(),
  duration_terms: z.string().optional().nullable(),
});

export type ShippoRate = z.infer<typeof shippoRateSchema>;

const shippoShipmentResponseSchema = z.object({
  object_id: z.string(),
  status: z.string(),
  rates: z.array(shippoRateSchema),
});

const carrierAccountsListSchema = z.object({
  results: z.array(z.unknown()).optional(),
  count: z.number().optional(),
});

const transactionResponseSchema = z.object({
  object_id: z.string(),
  status: z.string(),
  tracking_number: z.string().optional().nullable(),
  messages: z.array(z.unknown()).optional(),
  metadata: z.string().optional().nullable(),
});

const refundResponseSchema = z.object({
  object_id: z.string(),
  status: z.string(),
  transaction: z.string().optional().nullable(),
});

export type ShippoRateRequest = {
  toAddress: {
    name?: string | null;
    company?: string | null;
    street1: string;
    street2?: string | null;
    city: string;
    state?: string | null;
    zip: string;
    country: string;
    phone?: string | null;
  };
  fromAddress: {
    name?: string | null;
    company?: string | null;
    street1: string;
    street2?: string | null;
    city: string;
    state?: string | null;
    zip: string;
    country: string;
    phone?: string | null;
  };
  parcel: {
    weightOunces: number;
    lengthInches?: number | null;
    widthInches?: number | null;
    heightInches?: number | null;
  };
};

export class ShippoClient {
  private readonly apiToken: string;
  private readonly timeoutMs: number;

  constructor(config: { apiToken: string; timeoutMs?: number }) {
    this.apiToken = config.apiToken;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  /** Lightweight token check: lists carrier accounts (first page). */
  async verifyApiToken(
    opts?: { timeoutMs?: number },
  ): Promise<Result<{ count: number }, ShippoApiErrorInstance>> {
    const timeoutMs = opts?.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${SHIPPO_API_BASE}/carrier_accounts/?results=1`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `ShippoToken ${this.apiToken}`,
        },
        signal: controller.signal,
      });

      const rawText = await response.text();

      if (response.status === 401 || response.status === 403) {
        return err(
          new ShippoApiError.Unauthorized(
            `Shippo auth failed (${response.status}). Check your Shippo API token.`,
            { cause: new BaseError(rawText.slice(0, 200)) },
          ),
        );
      }

      if (!response.ok) {
        return err(
          new ShippoApiError.BadRequest(`Shippo request failed (${response.status})`, {
            cause: new BaseError(rawText.slice(0, 500)),
          }),
        );
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(rawText);
      } catch (cause) {
        return err(new ShippoApiError.InvalidResponse("Shippo returned non-JSON", { cause }));
      }

      const result = carrierAccountsListSchema.safeParse(parsed);

      if (!result.success) {
        return err(
          new ShippoApiError.InvalidResponse("Shippo carrier_accounts response failed validation", {
            cause: result.error,
          }),
        );
      }

      return ok({ count: result.data.count ?? result.data.results?.length ?? 0 });
    } catch (cause) {
      if ((cause as Error | undefined)?.name === "AbortError") {
        return err(
          new ShippoApiError.Timeout(`Shippo request timed out after ${timeoutMs}ms`, { cause }),
        );
      }

      return err(new ShippoApiError.NetworkError("Shippo network error", { cause }));
    } finally {
      clearTimeout(timer);
    }
  }

  async purchaseLabel(input: {
    rateObjectId: string;
    labelFileType: string;
    metadata: string;
  }): Promise<
    Result<
      { objectId: string; status: string; trackingNumber: string | null },
      ShippoApiErrorInstance
    >
  > {
    const timeoutMs = this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const body = {
      rate: input.rateObjectId,
      label_file_type: input.labelFileType,
      metadata: input.metadata,
      async: false,
    };

    try {
      const response = await fetch(`${SHIPPO_API_BASE}/transactions/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `ShippoToken ${this.apiToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const rawText = await response.text();

      if (response.status === 401 || response.status === 403) {
        return err(
          new ShippoApiError.Unauthorized(
            `Shippo auth failed (${response.status}). Check your Shippo API token.`,
            { cause: new BaseError(rawText.slice(0, 200)) },
          ),
        );
      }

      if (!response.ok) {
        logger.warn("Shippo transaction non-ok", { status: response.status, body: rawText.slice(0, 300) });

        return err(
          new ShippoApiError.BadRequest(`Shippo transaction failed (${response.status})`, {
            cause: new BaseError(rawText.slice(0, 800)),
          }),
        );
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(rawText);
      } catch (cause) {
        return err(new ShippoApiError.InvalidResponse("Shippo returned non-JSON", { cause }));
      }

      const result = transactionResponseSchema.safeParse(parsed);

      if (!result.success) {
        return err(
          new ShippoApiError.InvalidResponse("Shippo transaction response failed validation", {
            cause: result.error,
          }),
        );
      }

      return ok({
        objectId: result.data.object_id,
        status: result.data.status,
        trackingNumber: result.data.tracking_number ?? null,
      });
    } catch (cause) {
      if ((cause as Error | undefined)?.name === "AbortError") {
        return err(
          new ShippoApiError.Timeout(`Shippo request timed out after ${timeoutMs}ms`, { cause }),
        );
      }

      return err(new ShippoApiError.NetworkError("Shippo network error", { cause }));
    } finally {
      clearTimeout(timer);
    }
  }

  async createRefund(input: {
    transactionObjectId: string;
  }): Promise<Result<{ objectId: string; status: string }, ShippoApiErrorInstance>> {
    const timeoutMs = this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${SHIPPO_API_BASE}/refunds/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `ShippoToken ${this.apiToken}`,
        },
        body: JSON.stringify({ transaction: input.transactionObjectId }),
        signal: controller.signal,
      });

      const rawText = await response.text();

      if (response.status === 401 || response.status === 403) {
        return err(
          new ShippoApiError.Unauthorized(`Shippo auth failed (${response.status}).`, {
            cause: new BaseError(rawText.slice(0, 200)),
          }),
        );
      }

      if (!response.ok) {
        return err(
          new ShippoApiError.BadRequest(`Shippo refund failed (${response.status})`, {
            cause: new BaseError(rawText.slice(0, 500)),
          }),
        );
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(rawText);
      } catch (cause) {
        return err(new ShippoApiError.InvalidResponse("Shippo returned non-JSON", { cause }));
      }

      const result = refundResponseSchema.safeParse(parsed);

      if (!result.success) {
        return err(
          new ShippoApiError.InvalidResponse("Shippo refund response failed validation", {
            cause: result.error,
          }),
        );
      }

      return ok({ objectId: result.data.object_id, status: result.data.status });
    } catch (cause) {
      if ((cause as Error | undefined)?.name === "AbortError") {
        return err(
          new ShippoApiError.Timeout(`Shippo request timed out after ${timeoutMs}ms`, { cause }),
        );
      }

      return err(new ShippoApiError.NetworkError("Shippo network error", { cause }));
    } finally {
      clearTimeout(timer);
    }
  }

  async getRates(
    input: ShippoRateRequest,
    opts?: { timeoutMs?: number },
  ): Promise<Result<{ rates: ShippoRate[] }, ShippoApiErrorInstance>> {
    const timeoutMs = opts?.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const lengthIn = input.parcel.lengthInches ?? DEFAULT_PARCEL_LENGTH_IN;
    const widthIn = input.parcel.widthInches ?? DEFAULT_PARCEL_WIDTH_IN;
    const heightIn = input.parcel.heightInches ?? DEFAULT_PARCEL_HEIGHT_IN;

    const body = {
      address_from: {
        name: input.fromAddress.name ?? "",
        company: input.fromAddress.company ?? "",
        street1: input.fromAddress.street1,
        street2: input.fromAddress.street2 ?? "",
        city: input.fromAddress.city,
        state: input.fromAddress.state ?? "",
        zip: input.fromAddress.zip,
        country: input.fromAddress.country,
        phone: input.fromAddress.phone ?? "",
      },
      address_to: {
        name: input.toAddress.name ?? "",
        company: input.toAddress.company ?? "",
        street1: input.toAddress.street1,
        street2: input.toAddress.street2 ?? "",
        city: input.toAddress.city,
        state: input.toAddress.state ?? "",
        zip: input.toAddress.zip,
        country: input.toAddress.country,
        phone: input.toAddress.phone ?? "",
      },
      parcels: [
        {
          weight: String(input.parcel.weightOunces),
          mass_unit: "oz",
          length: String(lengthIn),
          width: String(widthIn),
          height: String(heightIn),
          distance_unit: "in",
        },
      ],
      async: false,
    };

    try {
      const response = await fetch(`${SHIPPO_API_BASE}/shipments/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `ShippoToken ${this.apiToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const rawText = await response.text();

      if (response.status === 401 || response.status === 403) {
        return err(
          new ShippoApiError.Unauthorized(
            `Shippo auth failed (${response.status}). Check your Shippo API token.`,
            { cause: new BaseError(rawText.slice(0, 200)) },
          ),
        );
      }

      if (!response.ok) {
        logger.warn("Shippo non-ok response", { status: response.status, body: rawText.slice(0, 200) });

        return err(
          new ShippoApiError.BadRequest(`Shippo request failed (${response.status})`, {
            cause: new BaseError(rawText.slice(0, 500)),
          }),
        );
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(rawText);
      } catch (cause) {
        return err(new ShippoApiError.InvalidResponse("Shippo returned non-JSON", { cause }));
      }

      const result = shippoShipmentResponseSchema.safeParse(parsed);

      if (!result.success) {
        logger.warn("Shippo response shape mismatch", { issues: result.error.issues });

        return err(
          new ShippoApiError.InvalidResponse("Shippo response failed validation", {
            cause: result.error,
          }),
        );
      }

      return ok({ rates: result.data.rates });
    } catch (cause) {
      if ((cause as Error | undefined)?.name === "AbortError") {
        return err(
          new ShippoApiError.Timeout(`Shippo request timed out after ${timeoutMs}ms`, { cause }),
        );
      }

      return err(new ShippoApiError.NetworkError("Shippo network error", { cause }));
    } finally {
      clearTimeout(timer);
    }
  }
}
