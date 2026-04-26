import { useAppBridge, withAuthorization } from "@saleor/app-sdk/app-bridge";
import { isInIframe } from "@saleor/apps-shared/is-in-iframe";
import { Text } from "@saleor/macaw-ui";

import { ConfigurationView } from "@/views/configuration/configuration-view";

const IndexPage = () => {
  const { appBridgeState } = useAppBridge();

  if (isInIframe() && !appBridgeState?.token) {
    return <div>Loading</div>;
  }

  if (!appBridgeState) {
    return null;
  }

  if (appBridgeState.user?.permissions.includes("MANAGE_APPS") === false) {
    return <Text>You do not have permission to access this page.</Text>;
  }

  return <ConfigurationView />;
};

export default withAuthorization({
  notIframe: <div>ShippingEasy app can only be used from the Saleor Dashboard.</div>,
  unmounted: null,
  noDashboardToken: <div>Error authorizing with Saleor Dashboard</div>,
  dashboardTokenInvalid: <div>Error authorizing with Saleor Dashboard</div>,
})(IndexPage);
