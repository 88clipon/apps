import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";
import { TRPCClientError } from "@trpc/client";
import { useMemo, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

import { ChannelMappingPanel } from "./channel-mapping-panel";
import { TestConnectionPanel } from "./test-connection-panel";

const emptyConfig = {
  id: undefined as string | undefined,
  name: "",
  apiKey: "",
  apiSecret: "",
  storeId: "",
  webhookSecret: "",
  shippoApiToken: "",
  originAddress: {
    name: "",
    company: "",
    street1: "",
    street2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "US",
    phone: "",
    email: "",
  },
  packageDefaults: { weightOunces: 8 },
  enabledCarriers: ["usps", "ups"] as ("usps" | "ups" | "fedex" | "dhl" | "dhl_ecommerce")[],
  domesticServicesRaw: "usps_priority_express",
  internationalServicesRaw: "usps_priority_mail_international,usps_first_class_package_international_service",
  rateMarkup: { type: "none" as const, value: 0 },
  emailsHandledBy: "shippingeasy" as "shippingeasy" | "saleor",
};

const parseServiceList = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const ConfigurationView = () => {
  const configsQuery = trpcClient.config.getAll.useQuery();
  const saveMutation = trpcClient.config.save.useMutation({
    onSuccess: () => configsQuery.refetch(),
  });
  const removeMutation = trpcClient.config.remove.useMutation({
    onSuccess: () => configsQuery.refetch(),
  });

  const [form, setForm] = useState(emptyConfig);
  const [notice, setNotice] = useState<string | null>(null);

  const existingConfigs = useMemo(() => configsQuery.data?.configs ?? [], [configsQuery.data]);

  const handleSave = async () => {
    setNotice(null);
    const storeId = form.storeId.trim();

    if (!storeId) {
      setNotice(
        "Store ID is required. In ShippingEasy, open Settings → Stores & Orders (or API credentials) and copy the numeric Store ID.",
      );

      return;
    }

    try {
      const { domesticServicesRaw, internationalServicesRaw, ...rest } = form;

      await saveMutation.mutateAsync({
        ...rest,
        storeId,
        domesticServices: parseServiceList(domesticServicesRaw),
        internationalServices: parseServiceList(internationalServicesRaw),
      });
      setNotice("Configuration saved.");
      setForm(emptyConfig);
    } catch (e) {
      if (e instanceof TRPCClientError) {
        const zod = e.data?.zodError as { fieldErrors?: Record<string, string[]> } | undefined;
        const first =
          zod?.fieldErrors &&
          Object.entries(zod.fieldErrors).find(([, msgs]) => msgs && msgs.length > 0);
        const detail = first ? `${first[0]}: ${first[1].join("; ")}` : e.message;

        setNotice(`Save failed: ${detail}`);

        return;
      }
      setNotice(`Save failed: ${(e as Error).message}`);
    }
  };

  return (
    <Box display="flex" flexDirection="column" gap={10}>
      <Box display="flex" flexDirection="column" gap={4}>
        <Text size={8}>ShippingEasy Configuration</Text>
        <Text>
          Connect your ShippingEasy store to push orders, display live carrier rates at checkout,
          and sync tracking back to Saleor.
        </Text>
      </Box>

      <Box display="flex" flexDirection="column" gap={4}>
        <Text size={6}>Existing configurations</Text>
        {existingConfigs.length === 0 && <Text color="default2">No configurations yet.</Text>}
        {existingConfigs.map((cfg) => (
          <Box
            key={cfg.id}
            display="flex"
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
            padding={3}
            borderWidth={1}
            borderStyle="solid"
            borderRadius={3}
          >
            <Box>
              <Text>
                <strong>{cfg.name}</strong> (store #{cfg.storeId})
              </Text>
              <Text size={2} color="default2">
                API key {cfg.apiKeyMasked} • carriers: {cfg.enabledCarriers.join(", ")} • emails:{" "}
                {cfg.emailsHandledBy}
              </Text>
            </Box>
            <Button
              variant="tertiary"
              onClick={() => removeMutation.mutate({ configId: cfg.id })}
              disabled={removeMutation.isLoading}
            >
              Remove
            </Button>
          </Box>
        ))}
      </Box>

      <Box
        display="flex"
        flexDirection="column"
        gap={4}
        padding={6}
        borderWidth={1}
        borderStyle="solid"
        borderRadius={3}
      >
        <Text size={6}>Add a ShippingEasy store</Text>

        <Input
          label="Configuration name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <Input
          label="API key"
          value={form.apiKey}
          onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
        />
        <Input
          label="API secret"
          type="password"
          value={form.apiSecret}
          onChange={(e) => setForm((f) => ({ ...f, apiSecret: e.target.value }))}
        />
        <Input
          label="Store ID (numeric, from ShippingEasy)"
          value={form.storeId}
          onChange={(e) => setForm((f) => ({ ...f, storeId: e.target.value }))}
        />
        <Input
          label="Webhook secret (optional, defaults to API secret)"
          type="password"
          value={form.webhookSecret}
          onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
        />

        <TestConnectionPanel
          apiKey={form.apiKey}
          apiSecret={form.apiSecret}
          storeId={form.storeId}
        />

        <Text size={5}>Shippo API (for live shipping rates at checkout)</Text>
        <Text size={2} color="default2">
          ShippingEasy does not expose a rate-quoting API to customers. To show live USPS rates at
          checkout, create a free account at goshippo.com and enter your API token below. Leave
          blank to hide shipping rates at checkout.
        </Text>
        <Input
          label="Shippo API token"
          type="password"
          value={form.shippoApiToken}
          onChange={(e) => setForm((f) => ({ ...f, shippoApiToken: e.target.value }))}
          helperText="From goshippo.com → API → Token — use the live token for real rates"
        />

        <Text size={5}>Origin address</Text>
        <Input
          label="Name"
          value={form.originAddress.name}
          onChange={(e) =>
            setForm((f) => ({ ...f, originAddress: { ...f.originAddress, name: e.target.value } }))
          }
        />
        <Input
          label="Street"
          value={form.originAddress.street1}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              originAddress: { ...f.originAddress, street1: e.target.value },
            }))
          }
        />
        <Box display="grid" __gridTemplateColumns="1fr 1fr 1fr" gap={3}>
          <Input
            label="City"
            value={form.originAddress.city}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                originAddress: { ...f.originAddress, city: e.target.value },
              }))
            }
          />
          <Input
            label="State / Region"
            value={form.originAddress.state}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                originAddress: { ...f.originAddress, state: e.target.value },
              }))
            }
          />
          <Input
            label="Postal code"
            value={form.originAddress.postalCode}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                originAddress: { ...f.originAddress, postalCode: e.target.value },
              }))
            }
          />
        </Box>
        <Input
          label="Country (ISO-2)"
          value={form.originAddress.country}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              originAddress: { ...f.originAddress, country: e.target.value.toUpperCase() },
            }))
          }
        />

        <Text size={5}>Default package</Text>
        <Input
          label="Default weight (oz)"
          type="number"
          value={String(form.packageDefaults.weightOunces)}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              packageDefaults: { ...f.packageDefaults, weightOunces: Number(e.target.value) },
            }))
          }
        />

        <Text size={5}>Service filtering (Shippo service tokens)</Text>
        <Text size={2} color="default2">
          Restrict which carrier services appear at checkout. Use Shippo service-level tokens,
          comma-separated. Common USPS tokens: usps_priority_express (Priority Mail Express),
          usps_priority (Priority Mail), usps_priority_mail_international,
          usps_first_class_package_international_service. Leave blank to show all services.
        </Text>
        <Input
          label="Domestic service allowlist"
          value={form.domesticServicesRaw}
          onChange={(e) => setForm((f) => ({ ...f, domesticServicesRaw: e.target.value }))}
          helperText="Services shown when destination country matches origin country"
        />
        <Input
          label="International service allowlist"
          value={form.internationalServicesRaw}
          onChange={(e) => setForm((f) => ({ ...f, internationalServicesRaw: e.target.value }))}
          helperText="Services shown when destination country differs from origin country"
        />

        <Text size={5}>Emails</Text>
        <Select
          label="Send shipping emails via"
          value={form.emailsHandledBy}
          onChange={(value) =>
            setForm((f) => ({ ...f, emailsHandledBy: value as "shippingeasy" | "saleor" }))
          }
          options={[
            { value: "shippingeasy", label: "ShippingEasy (branded tracking emails)" },
            { value: "saleor", label: "Saleor (default)" },
          ]}
        />

        <Button onClick={handleSave} disabled={saveMutation.isLoading}>
          {saveMutation.isLoading ? "Saving..." : "Save configuration"}
        </Button>

        {notice && <Text>{notice}</Text>}
      </Box>

      <ChannelMappingPanel
        configs={existingConfigs}
        mapping={configsQuery.data?.channelMapping ?? {}}
      />
    </Box>
  );
};
