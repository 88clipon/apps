import { checkoutCreatedWebhookDefinition } from "@/app/api/webhooks/saleor/checkout-created/webhook-definition";
import { checkoutUpdatedWebhookDefinition } from "@/app/api/webhooks/saleor/checkout-updated/webhook-definition";
import { orderCreatedWebhookDefinition } from "@/app/api/webhooks/saleor/order-created/webhook-definition";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { saleorApp } from "@/lib/saleor-app";

const logger = createLogger("SyncSaleorWebhooks");

type WebhookManifestLite = {
  name: string;
  query: string;
  targetUrl: string;
  isActive: boolean;
  asyncEvents?: string[];
  syncEvents?: string[];
};

const WEBHOOK_SYNCS: ReadonlyArray<{
  name: string;
  getManifest: (baseUrl: string) => WebhookManifestLite;
}> = [
  {
    name: "Abandoned cart - checkout created",
    getManifest: (baseUrl) =>
      checkoutCreatedWebhookDefinition.getWebhookManifest(baseUrl) as WebhookManifestLite,
  },
  {
    name: "Abandoned cart - checkout updated",
    getManifest: (baseUrl) =>
      checkoutUpdatedWebhookDefinition.getWebhookManifest(baseUrl) as WebhookManifestLite,
  },
  {
    name: "Abandoned cart - order created (recovery marker)",
    getManifest: (baseUrl) =>
      orderCreatedWebhookDefinition.getWebhookManifest(baseUrl) as WebhookManifestLite,
  },
];

async function callSaleor<T>(
  saleorApiUrl: string,
  token: string,
  body: { query: string; variables?: Record<string, unknown> },
): Promise<{ data?: T; errors?: unknown }> {
  const res = await fetch(saleorApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  return (await res.json()) as { data?: T; errors?: unknown };
}

/**
 * Pushes manifest subscription queries to Saleor for webhooks that embed the
 * query in code. Saleor stores `subscription_query` and `target_url` at install
 * time; subsequent deploys do not refresh them automatically.
 *
 * Also creates webhooks that the manifest declares but Saleor does not yet have
 * for this app instance — this fixes installs that pre-date a newly added
 * webhook (e.g. ORDER_CREATED) and would otherwise silently never fire.
 */
export async function syncSaleorWebhookSubscriptionsFromManifest(): Promise<void> {
  const baseUrl = env.APP_API_BASE_URL ?? env.APP_IFRAME_BASE_URL;

  if (!baseUrl) {
    logger.warn("Skipping webhook subscription sync: APP_API_BASE_URL / APP_IFRAME_BASE_URL not set");

    return;
  }

  let entries;

  try {
    entries = await saleorApp.apl.getAll();
  } catch (error) {
    logger.warn("APL getAll failed", { message: (error as Error).message });

    return;
  }

  for (const auth of entries) {
    try {
      const listJson = await callSaleor<{
        app?: { id: string; webhooks?: { id: string; name: string | null }[] };
      }>(auth.saleorApiUrl, auth.token, {
        query: "{ app { id webhooks { id name } } }",
      });

      if (Array.isArray(listJson.errors) && listJson.errors.length > 0) {
        logger.warn("app { webhooks } query failed", {
          saleorApiUrl: auth.saleorApiUrl,
          errors: listJson.errors,
        });
        continue;
      }

      const webhooks = listJson.data?.app?.webhooks;
      const appId = listJson.data?.app?.id;

      for (const { name, getManifest } of WEBHOOK_SYNCS) {
        const manifest = getManifest(baseUrl);
        const wh = webhooks?.find((w) => w.name === name);

        if (!wh) {
          if (!appId) {
            logger.warn("Cannot create missing webhook: app id missing from response", {
              saleorApiUrl: auth.saleorApiUrl,
              name,
            });
            continue;
          }

          const createJson = await callSaleor<{
            webhookCreate?: {
              errors?: { message: string }[];
              webhook?: { id: string };
            };
          }>(auth.saleorApiUrl, auth.token, {
            query: `mutation CreateWh($input: WebhookCreateInput!) {
              webhookCreate(input: $input) {
                errors { message field code }
                webhook { id }
              }
            }`,
            variables: {
              input: {
                name: manifest.name,
                targetUrl: manifest.targetUrl,
                isActive: manifest.isActive,
                query: manifest.query,
                asyncEvents: manifest.asyncEvents ?? [],
                syncEvents: manifest.syncEvents ?? [],
                app: appId,
              },
            },
          });

          if (Array.isArray(createJson.errors) && createJson.errors.length > 0) {
            logger.warn("webhookCreate GraphQL errors", {
              saleorApiUrl: auth.saleorApiUrl,
              name,
              errors: createJson.errors,
            });
            continue;
          }

          const createMutErrors = createJson.data?.webhookCreate?.errors;

          if (createMutErrors?.length) {
            logger.warn("webhookCreate mutation errors", {
              saleorApiUrl: auth.saleorApiUrl,
              name,
              errors: createMutErrors,
            });
            continue;
          }

          logger.info("Created missing webhook from manifest", {
            saleorApiUrl: auth.saleorApiUrl,
            name,
            webhookId: createJson.data?.webhookCreate?.webhook?.id,
            asyncEvents: manifest.asyncEvents,
            syncEvents: manifest.syncEvents,
          });
          continue;
        }

        const updateJson = await callSaleor<{
          webhookUpdate?: {
            errors?: { message: string }[];
            webhook?: { id: string };
          };
        }>(auth.saleorApiUrl, auth.token, {
          query: `mutation SyncWhSubscription(
              $id: ID!,
              $query: String!,
              $targetUrl: String,
              $isActive: Boolean,
              $asyncEvents: [WebhookEventTypeAsyncEnum!],
              $syncEvents: [WebhookEventTypeSyncEnum!]
            ) {
              webhookUpdate(id: $id, input: {
                query: $query,
                targetUrl: $targetUrl,
                isActive: $isActive,
                asyncEvents: $asyncEvents,
                syncEvents: $syncEvents
              }) {
                errors { message field code }
                webhook { id }
              }
            }`,
          variables: {
            id: wh.id,
            query: manifest.query,
            targetUrl: manifest.targetUrl,
            isActive: manifest.isActive,
            asyncEvents: manifest.asyncEvents ?? [],
            syncEvents: manifest.syncEvents ?? [],
          },
        });

        if (Array.isArray(updateJson.errors) && updateJson.errors.length > 0) {
          logger.warn("webhookUpdate GraphQL errors", {
            saleorApiUrl: auth.saleorApiUrl,
            name,
            errors: updateJson.errors,
          });
          continue;
        }

        const mutErrors = updateJson.data?.webhookUpdate?.errors;

        if (mutErrors?.length) {
          logger.warn("webhookUpdate mutation errors", {
            saleorApiUrl: auth.saleorApiUrl,
            name,
            errors: mutErrors,
          });
          continue;
        }

        logger.info("Synced webhook subscription from manifest", {
          saleorApiUrl: auth.saleorApiUrl,
          webhookId: wh.id,
          name,
          targetUrl: manifest.targetUrl,
          asyncEvents: manifest.asyncEvents,
          syncEvents: manifest.syncEvents,
        });
      }
    } catch (error) {
      logger.warn("Sync attempt failed", {
        saleorApiUrl: auth.saleorApiUrl,
        message: (error as Error).message,
      });
    }
  }
}
