import { z } from "zod";

/**
 * Narrow, pragmatic Zod schemas for the ShippingEasy API.
 * The upstream API returns more fields than we parse here; we only validate
 * the shape we actually consume so upstream additions don't break us.
 */

export const shippingEasyAddressSchema = z.object({
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  street1: z.string(),
  street2: z.string().optional().nullable(),
  city: z.string(),
  state: z.string(),
  postal_code: z.string(),
  country: z.string(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
});
export type ShippingEasyAddress = z.infer<typeof shippingEasyAddressSchema>;

export const shippingEasyRateSchema = z.object({
  id: z.string().or(z.number()).transform(String),
  carrier: z.string(),
  service: z.string(),
  service_description: z.string().optional().nullable(),
  rate: z.coerce.number(),
  currency: z.string().default("USD"),
  estimated_delivery_days_min: z.number().optional().nullable(),
  estimated_delivery_days_max: z.number().optional().nullable(),
});
export type ShippingEasyRate = z.infer<typeof shippingEasyRateSchema>;

export const shippingEasyRatesResponseSchema = z.object({
  rates: z.array(shippingEasyRateSchema),
});

export const shippingEasyStoreSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().optional().nullable(),
  platform: z.string().optional().nullable(),
});

export const shippingEasyStoresResponseSchema = z.object({
  stores: z.array(shippingEasyStoreSchema),
});

export const shippingEasyOrderCreateResponseSchema = z.object({
  order: z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    external_order_identifier: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
  }),
});

export const shippingEasyShipmentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  tracking_number: z.string().optional().nullable(),
  carrier: z.string().optional().nullable(),
  service: z.string().optional().nullable(),
  tracking_url: z.string().optional().nullable(),
  label_url: z.string().optional().nullable(),
  shipped_at: z.string().optional().nullable(),
});
export type ShippingEasyShipment = z.infer<typeof shippingEasyShipmentSchema>;

/**
 * Inbound webhook payload shape. ShippingEasy's webhooks are sparse and
 * sometimes nest the shipment/label under `data.shipment` or `data.label`.
 */
export const shippingEasyWebhookEventSchema = z.object({
  event: z.string(),
  event_id: z.string().optional(),
  store_id: z.union([z.string(), z.number()]).transform(String).optional(),
  data: z
    .object({
      external_order_identifier: z.string().optional().nullable(),
      order_id: z.union([z.string(), z.number()]).transform(String).optional(),
      shipment: shippingEasyShipmentSchema.partial().optional(),
      label: z
        .object({
          tracking_number: z.string().optional().nullable(),
          carrier: z.string().optional().nullable(),
          service: z.string().optional().nullable(),
          tracking_url: z.string().optional().nullable(),
        })
        .optional(),
    })
    .passthrough(),
});
export type ShippingEasyWebhookEvent = z.infer<typeof shippingEasyWebhookEventSchema>;
