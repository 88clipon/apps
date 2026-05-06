import { Box, Input, Select, Text } from "@saleor/macaw-ui";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

type ConfigSummary = { id: string; name: string };

type Props = {
  configs: readonly ConfigSummary[];
  mapping: Record<string, string>;
};

export const ChannelMappingPanel = ({ configs, mapping }: Props) => {
  const [channelSlug, setChannelSlug] = useState("");
  const [selectedConfig, setSelectedConfig] = useState<string>("");

  const updateMutation = trpcClient.config.updateMapping.useMutation();

  const handleSave = async () => {
    if (!channelSlug) return;
    await updateMutation.mutateAsync({
      channelSlug,
      configId: selectedConfig.length > 0 ? selectedConfig : null,
    });
    setChannelSlug("");
    setSelectedConfig("");
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap={3}
      padding={6}
      borderWidth={1}
      borderStyle="solid"
      borderRadius={3}
    >
      <Text size={6}>Channel &rarr; Config mapping</Text>
      <Text size={2} color="default2">
        Map each Saleor channel slug to the Shippo configuration that should handle checkout
        rates and labels for that channel.
      </Text>

      {Object.entries(mapping).length > 0 && (
        <Box as="ul" display="flex" flexDirection="column" gap={2}>
          {Object.entries(mapping).map(([slug, cfgId]) => (
            <Text key={slug} size={2}>
              {slug} &rarr; {configs.find((c) => c.id === cfgId)?.name ?? cfgId}
            </Text>
          ))}
        </Box>
      )}

      <Input
        label="Channel slug"
        value={channelSlug}
        onChange={(e) => setChannelSlug(e.target.value)}
      />
      <Select
        label="Shippo configuration"
        value={selectedConfig}
        onChange={(v) => setSelectedConfig(v as string)}
        options={[
          { value: "", label: "Unmap (remove)" },
          ...configs.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      <button
        onClick={handleSave}
        disabled={!channelSlug || updateMutation.isLoading}
        style={{ alignSelf: "flex-start" }}
      >
        {updateMutation.isLoading ? "Saving..." : "Save mapping"}
      </button>
    </Box>
  );
};
