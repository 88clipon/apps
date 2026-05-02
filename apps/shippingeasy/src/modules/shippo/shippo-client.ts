import { err, ok, Result } from "neverthrow";
import { z } from "zod";

import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ShippoClient");

const SHIPPO_API_BASE = "https://api.goshippo.com";

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

  async getRates(
    input: ShippoRateRequest,
    opts?: { timeoutMs?: number },
  ): Promise<Result<{ rates: ShippoRate[] }, ShippoApiErrorInstance>> {
    const timeoutMs = opts?.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

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
          ...(input.parcel.lengthInches != null && {
            length: String(input.parcel.lengthInches),
          }),
          ...(input.parcel.widthInches != null && {
            width: String(input.parcel.widthInches),
          }),
          ...(input.parcel.heightInches != null && {
            height: String(input.parcel.heightInches),
          }),
          ...(input.parcel.lengthInches != null && { distance_unit: "in" }),
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
