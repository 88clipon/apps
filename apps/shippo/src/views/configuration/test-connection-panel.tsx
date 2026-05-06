import { Box, Button, Text } from "@saleor/macaw-ui";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

type Props = {
  shippoApiToken: string;
};

export const TestConnectionPanel = ({ shippoApiToken }: Props) => {
  const [lastResult, setLastResult] = useState<string | null>(null);
  const testMutation = trpcClient.config.testConnection.useMutation();

  const canTest = shippoApiToken.length > 0;

  const handleClick = async () => {
    try {
      const result = await testMutation.mutateAsync({ shippoApiToken });

      if (!result.ok) {
        setLastResult(`Failed: ${result.message}`);

        return;
      }
      setLastResult(`Connected. Carrier accounts (approx): ${result.carrierAccountsApprox}.`);
    } catch (e) {
      setLastResult(`Failed: ${(e as Error).message}`);
    }
  };

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Button variant="tertiary" onClick={handleClick} disabled={!canTest || testMutation.isLoading}>
        {testMutation.isLoading ? "Testing..." : "Test Shippo token"}
      </Button>
      {lastResult && <Text size={2}>{lastResult}</Text>}
    </Box>
  );
};
