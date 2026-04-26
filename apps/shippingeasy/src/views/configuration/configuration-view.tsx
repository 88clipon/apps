import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";
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
  rateMarkup: { type: "none" as const, value: 0 },
  emailsHandledBy: "shippingeasy" as "shippingeasy" | "saleor",
};

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
    try {
      await saveMutation.mutateAsync(form);
      setNotice("Configuration saved.");
      setForm(emptyConfig);
    } catch (e) {
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
          label="Store ID"
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
