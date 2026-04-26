import { Box, Button, Text } from "@saleor/macaw-ui";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

type Props = {
  apiKey: string;
  apiSecret: string;
  storeId: string;
};

export const TestConnectionPanel = ({ apiKey, apiSecret, storeId }: Props) => {
  const [lastResult, setLastResult] = useState<string | null>(null);
  const testMutation = trpcClient.config.testConnection.useMutation();

  const canTest = apiKey.length > 0 && apiSecret.length > 0 && storeId.length > 0;

  const handleClick = async () => {
    try {
      const result = await testMutation.mutateAsync({ apiKey, apiSecret, storeId });

      if (!result.ok) {
        setLastResult(`Failed: ${result.message}`);

        return;
      }
      setLastResult(
        result.storeMatch
          ? `Connected. Store #${storeId} found.`
          : `Connected, but store #${storeId} is not in the authorized list. Found: ${result.stores
              .map((s) => `#${s.id}`)
              .join(", ")}`,
      );
    } catch (e) {
      setLastResult(`Failed: ${(e as Error).message}`);
    }
  };

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Button variant="tertiary" onClick={handleClick} disabled={!canTest || testMutation.isLoading}>
        {testMutation.isLoading ? "Testing..." : "Test connection"}
      </Button>
      {lastResult && <Text size={2}>{lastResult}</Text>}
    </Box>
  );
};
