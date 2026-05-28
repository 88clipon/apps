<div align="center">
  <h1>Saleor App Shippo</h1>
</div>

Integrates [Shippo](https://goshippo.com/) with Saleor:

- Returns live carrier rates at checkout via the `SHIPPING_LIST_METHODS_FOR_CHECKOUT` synchronous webhook (rate IDs are `shippo-<rate_object_id>` for label purchase).
- Optionally purchases a label when an order is placed (`autoPurchaseLabel`), using the rate selected at checkout (rates can expire—see risks below).
- Requests a Shippo **refund** when `ORDER_CANCELLED` fires and a transaction id is stored on the order (unused labels only, per Shippo rules).
- Syncs tracking and fulfillments back into Saleor from Shippo webhooks (`transaction_created`, `transaction_updated`, `track_updated`) when the payload includes your `metadata` reference.

## Architecture

- **Config** is per Saleor channel and stored in DynamoDB when `APL=dynamodb` (or in-memory when `APL=file` for local dev).
- **Outbound** calls use `ShippoClient` (`/shipments/`, `/transactions/`, `/refunds/`, `/carrier_accounts/`) with `neverthrow` `Result` types.
- **Rate cache**: short TTL, in-memory in this build (same pattern as other apps in the monorepo).
- **Inbound webhooks** hit `POST /api/webhooks/shippo?saleorApiUrl=<encoded graphql url>` (or header `X-Shippo-Saleor-Api-Url`). If you configure an HMAC secret in the app UI, requests must include a valid `Shippo-Auth-Signature` header (see [Shippo webhook security](https://docs.goshippo.com/docs/tracking/webhooksecurity)).

## Saleor webhooks in the manifest

| Webhook                              | Sync? | Purpose                                                |
| ------------------------------------ | ----- | ------------------------------------------------------ |
| `SHIPPING_LIST_METHODS_FOR_CHECKOUT` | sync  | Inject Shippo-backed methods at checkout               |
| `CHECKOUT_FILTER_SHIPPING_METHODS`   | sync  | Optional; disabled by default (returns no exclusions)  |
| `ORDER_CREATED`                      | async | Link order / purchase label / metadata                 |
| `ORDER_CANCELLED`                    | async | Request Shippo refund for stored transaction           |

## Deploying on Railway

Use the **monorepo root** (directory with `pnpm-workspace.yaml`), not `apps/shippo` alone.

- **Start command**: `pnpm run start:shippo`  
  Do **not** use the repo default `pnpm start` for a single service: that runs every app at once on the same `PORT`.
- **Config-as-code**: set Railway to `apps/shippo/railway.toml`.
- **Build** (example): `pnpm --filter saleor-app-shippo build`.

Set environment variables as raw strings (no extra quotes inside the value). Ensure Saleor `ALLOWED_CLIENT_HOSTS` includes your app hostname.

## Migration from ShippingEasy

Uninstall or disable the ShippingEasy Saleor app to avoid duplicate checkout methods and duplicate `ORDER_*` handlers.

## Merchant setup

1. Install the app from the dashboard (custom manifest URL: `https://<host>/api/manifest`).
2. Create a Shippo config: API token, origin, package defaults, optional service allowlists, webhook secret (if using HMAC), auto-purchase toggle, label format.
3. Map each Saleor **channel slug** to a config.
4. In Shippo, add a webhook URL such as:  
   `https://<host>/api/webhooks/shippo?saleorApiUrl=<url-encoded Saleor GraphQL URL>`  
   Subscribe to transaction and/or tracking events you need.

## Local development

```shell
cd apps/shippo
cp .env.example .env
pnpm install   # from monorepo root
pnpm run generate
pnpm dev
```

## Risks

- **Rate expiry**: Checkout rates may no longer be purchasable if the customer completes payment long after quoting. In that case, purchase labels manually in Shippo or adjust checkout flow.
- **Refunds**: Shippo only refunds unused labels within carrier-specific windows.

## Tests

```shell
pnpm --dir apps/shippo test
```
