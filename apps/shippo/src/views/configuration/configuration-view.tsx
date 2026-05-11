import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";
import { TRPCClientError } from "@trpc/client";
import { useMemo, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

import { ChannelMappingPanel } from "./channel-mapping-panel";
import { TestConnectionPanel } from "./test-connection-panel";

const emptyConfig = {
  id: undefined as string | undefined,
  name: "",
  shippoApiToken: "",
  webhookSecret: "",
  autoPurchaseLabel: false,
  labelFileType: "PDF_4x6" as "PDF" | "PDF_4x6" | "PNG" | "ZPLII",
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
  domesticServicesRaw: "usps_priority_express",
  internationalServicesRaw: "usps_priority_mail_international,usps_first_class_package_international_service",
  rateMarkup: { type: "none" as "none" | "flat" | "percent", value: 0 },
  emailsHandledBy: "saleor" as "shippo" | "saleor",
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

  const isEditing = form.id !== undefined;

  const startEditing = (cfg: (typeof existingConfigs)[number]) => {
    setNotice(null);
    setForm({
      id: cfg.id,
      name: cfg.name,
      // Secrets are masked server-side and can't round-trip. Leave blank;
      // the user can either re-paste a new token/secret or save with the
      // field empty to keep the current one.
      shippoApiToken: "",
      webhookSecret: "",
      autoPurchaseLabel: cfg.autoPurchaseLabel,
      labelFileType: cfg.labelFileType,
      originAddress: {
        name: cfg.originAddress.name ?? "",
        company: cfg.originAddress.company ?? "",
        street1: cfg.originAddress.street1 ?? "",
        street2: cfg.originAddress.street2 ?? "",
        city: cfg.originAddress.city ?? "",
        state: cfg.originAddress.state ?? "",
        postalCode: cfg.originAddress.postalCode ?? "",
        country: cfg.originAddress.country ?? "US",
        phone: cfg.originAddress.phone ?? "",
        email: cfg.originAddress.email ?? "",
      },
      packageDefaults: { weightOunces: cfg.packageDefaults.weightOunces },
      domesticServicesRaw: cfg.domesticServices.join(", "),
      internationalServicesRaw: cfg.internationalServices.join(", "),
      rateMarkup: cfg.rateMarkup,
      emailsHandledBy: cfg.emailsHandledBy,
    });
  };

  const cancelEditing = () => {
    setNotice(null);
    setForm(emptyConfig);
  };

  const handleSave = async () => {
    setNotice(null);

    try {
      const { domesticServicesRaw, internationalServicesRaw, ...rest } = form;

      await saveMutation.mutateAsync({
        ...rest,
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
        <Text size={8}>Shippo</Text>
        <Text>
          Live rates at checkout via Shippo, optional automatic label purchase when orders are placed,
          refunds when orders are cancelled (unused labels), and fulfillment updates from Shippo
          webhooks.
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
                <strong>{cfg.name}</strong>
              </Text>
              <Text size={2} color="default2">
                Token {cfg.shippoApiTokenMasked || "—"} • auto-buy:{" "}
                {cfg.autoPurchaseLabel ? "on" : "off"} • label {cfg.labelFileType} • emails:{" "}
                {cfg.emailsHandledBy} • webhook secret:{" "}
                {cfg.webhookSecretConfigured ? "set" : "not set"}
              </Text>
            </Box>
            <Box display="flex" flexDirection="row" gap={2}>
              <Button
                variant="secondary"
                onClick={() => startEditing(cfg)}
                disabled={saveMutation.isLoading || removeMutation.isLoading}
              >
                Edit
              </Button>
              <Button
                variant="tertiary"
                onClick={() => removeMutation.mutate({ configId: cfg.id })}
                disabled={removeMutation.isLoading || form.id === cfg.id}
              >
                Remove
              </Button>
            </Box>
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
        <Box display="flex" flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text size={6}>{isEditing ? `Edit configuration: ${form.name || "(unnamed)"}` : "Add configuration"}</Text>
          {isEditing && (
            <Button variant="tertiary" onClick={cancelEditing}>
              Cancel edit
            </Button>
          )}
        </Box>

        <Input
          label="Configuration name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <Input
          label="Shippo API token"
          type="password"
          value={form.shippoApiToken}
          onChange={(e) => setForm((f) => ({ ...f, shippoApiToken: e.target.value }))}
          helperText={
            isEditing
              ? "Leave blank to keep the existing token. Paste a new one to replace it."
              : "From goshippo.com → API. Used for rating, purchasing labels, and refunds."
          }
        />

        <TestConnectionPanel shippoApiToken={form.shippoApiToken} />

        <Input
          label="Webhook HMAC secret (optional)"
          type="password"
          value={form.webhookSecret}
          onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
          helperText={
            isEditing
              ? "Leave blank to keep the existing secret. Paste a new one to replace it."
              : "If Shippo provides HMAC for your account, paste the secret here to verify Shippo-Auth-Signature."
          }
        />

        <Select
          label="Purchase shipping label automatically when order is placed"
          value={form.autoPurchaseLabel ? "true" : "false"}
          onChange={(value) =>
            setForm((f) => ({ ...f, autoPurchaseLabel: value === "true" }))
          }
          options={[
            { value: "false", label: "Off (save linkage only; buy labels in Shippo)" },
            { value: "true", label: "On (buy label from checkout rate — rates can expire)" },
          ]}
        />

        <Select
          label="Label file type"
          value={form.labelFileType}
          onChange={(value) =>
            setForm((f) => ({ ...f, labelFileType: value as typeof form.labelFileType }))
          }
          options={[
            { value: "PDF_4x6", label: "PDF 4x6 (thermal)" },
            { value: "PDF", label: "PDF" },
            { value: "PNG", label: "PNG" },
            { value: "ZPLII", label: "ZPLII" },
          ]}
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
          Comma-separated Shippo service-level tokens. Leave blank to allow all services returned by
          Shippo. Example: usps_priority_express, usps_priority.
        </Text>
        <Input
          label="Domestic service allowlist"
          value={form.domesticServicesRaw}
          onChange={(e) => setForm((f) => ({ ...f, domesticServicesRaw: e.target.value }))}
        />
        <Input
          label="International service allowlist"
          value={form.internationalServicesRaw}
          onChange={(e) => setForm((f) => ({ ...f, internationalServicesRaw: e.target.value }))}
        />

        <Text size={5}>Customer email for fulfillment / tracking updates</Text>
        <Select
          label="Send shipping notifications via"
          value={form.emailsHandledBy}
          onChange={(value) =>
            setForm((f) => ({ ...f, emailsHandledBy: value as "shippo" | "saleor" }))
          }
          options={[
            { value: "saleor", label: "Saleor (recommended for most stores)" },
            { value: "shippo", label: "Shippo / carrier (Saleor fulfillment calls use notifyCustomer: false)" },
          ]}
        />

        <Button onClick={handleSave} disabled={saveMutation.isLoading}>
          {saveMutation.isLoading
            ? "Saving..."
            : isEditing
              ? "Save changes"
              : "Save configuration"}
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
