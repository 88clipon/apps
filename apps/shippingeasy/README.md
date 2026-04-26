<div align="center">
  <h1>Saleor App ShippingEasy</h1>
</div>

Integrates [ShippingEasy](https://shippingeasy.com/) with Saleor:

- Pushes new Saleor orders into ShippingEasy so staff can print labels there.
- Syncs tracking numbers and fulfillment status back into Saleor when labels are created or shipments updated.
- Returns live carrier rates at checkout via the `SHIPPING_LIST_METHODS_FOR_CHECKOUT` synchronous webhook.
- Lets ShippingEasy own branded shipping confirmation / tracking emails (Saleor is told not to double-notify).

## Architecture

- **Config** is per Saleor channel and persisted in DynamoDB (or local file APL for dev). Each config stores API key/secret, store id, origin address, package defaults, enabled carriers, rate markup, and an `emailsHandledBy` toggle.
- **Outbound calls to ShippingEasy** are HMAC-SHA256 signed by `shippingeasy-client.ts`, typed with Zod, and wrapped in `neverthrow` `Result`s.
- **Rate caching**: checkout rate responses are cached briefly (in-memory in dev, DynamoDB in prod) keyed by channel + destination + weight bucket. Upstream failures short-circuit to an empty list so Saleor falls back to native shipping zones.
- **Inbound webhooks** (`label.created`, `shipment.updated`) hit `POST /api/webhooks/shippingeasy`, are de-duplicated by `event_id` in DynamoDB, resolved to a Saleor order via the `OrderLinkStore`, and then reconciled through `SyncTrackingFromShippingEasyUseCase`.

## Saleor webhooks declared in the manifest

| Webhook                                   | Sync? | Purpose                                                          |
| ----------------------------------------- | ----- | ---------------------------------------------------------------- |
| `SHIPPING_LIST_METHODS_FOR_CHECKOUT`      | sync  | Inject ShippingEasy rates as checkout shipping methods           |
| `CHECKOUT_FILTER_SHIPPING_METHODS`        | sync  | Optionally suppress native Saleor methods                        |
| `ORDER_CREATED`                           | async | Push order into ShippingEasy, store external id in metadata      |
| `ORDER_CANCELLED`                         | async | Cancel the corresponding ShippingEasy order                      |

## Emails

When a config is set to `emailsHandledBy: "shippingeasy"`:

- Outbound `POST /stores/:id/orders` is sent with `send_tracking_email` and `send_shipment_confirmation_email` enabled.
- Saleor's `orderFulfill` / `orderFulfillmentUpdateTracking` are called with `notifyCustomer: false` so customers get exactly one shipping email.

Flip it to `saleor` to keep Saleor's native notifications and disable ShippingEasy's.

## Local development

### Prerequisites

- Node.js 22+
- pnpm 10+
- DynamoDB local (only if running with `APL=dynamodb`)

### Running the app

```shell
cp .env.example .env
# fill in SECRET_KEY and (optionally) AWS_* / DYNAMODB_* values
pnpm install
pnpm dev
```

The app listens on `http://localhost:3000`. Install it in your Saleor dashboard; use a tunnel if Saleor is not reachable on localhost (see [Saleor tunneling guide](https://docs.saleor.io/developer/extending/apps/developing-with-tunnels)).

### Configuring ShippingEasy

After installation open the app in the Saleor dashboard and for each ShippingEasy store:

1. Paste the **API key** and **API secret** (found in ShippingEasy → Settings → Developer Integrations).
2. Enter the numeric **Store ID**.
3. Fill in the **Origin address**, default package weight, and enabled carriers.
4. Optionally set a **rate markup** and **webhook secret** (defaults to the API secret).
5. Choose whether **ShippingEasy or Saleor** sends the shipping confirmation email.
6. Map the config to one or more Saleor channels.
7. Click **Test connection** to verify credentials.

### Configuring the ShippingEasy webhook

Point ShippingEasy's webhook destination at:

```
https://<your-app-domain>/api/webhooks/shippingeasy?saleorApiUrl=<url-encoded saleor graphql url>
```

or pass the saleor api url via a `X-SE-Saleor-Api-Url` header. The webhook signature is verified against the `webhookSecret` on the matching config.

### Running tests

```shell
pnpm test
```

Tests mock the ShippingEasy REST API with MSW and exercise the HMAC signing, config domain, and sync-tracking use case.

## Notes & caveats

- ShippingEasy's `rates` endpoint is not optimized for low-latency checkout calls. A 3s timeout + short cache is applied; if reliability is insufficient for your traffic, swap the `list-shipping-rates.ts` backend for EasyPost/Shippo behind the same interface.
- Only the first warehouse stocking each variant is used when auto-fulfilling from a ShippingEasy label. Split shipments still need to be handled manually in the Saleor dashboard.
