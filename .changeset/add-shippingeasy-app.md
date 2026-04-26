---
"saleor-app-shippingeasy": minor
---

Add new Saleor App at `apps/shippingeasy` integrating with ShippingEasy:

- Returns live carrier rates at checkout via `SHIPPING_LIST_METHODS_FOR_CHECKOUT`.
- Pushes new Saleor orders into ShippingEasy on `ORDER_CREATED` and cancels them on `ORDER_CANCELLED`.
- Receives `label.created` / `shipment.updated` webhooks and writes fulfillment + tracking back into Saleor with event-id based idempotency.
- Per-channel DynamoDB-backed configuration UI with origin address, package defaults, carrier allowlist, rate markup and `emailsHandledBy` toggle controlling whether ShippingEasy or Saleor sends shipping confirmation emails.
