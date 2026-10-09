import { MantineProvider, Text, createTheme } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { getWpSuite, TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";
import { __ } from "@wordpress/i18n";

import Main from "./main";
import NavigationPages from "./navigation-pages";
import { parseNavigation } from "./navigation";
import "./index.css";
import ResetSettings from "./reset-settings";

import { initializeBackendCache } from "./backend-readiness-cache";

initializeBackendCache();

const theme = createTheme({
  respectReducedMotion: true,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: false,
      retryDelay: 0,
    },
  },
});

const wpsuite = getWpSuite();
const view = wpsuite?.view ?? "connect";
const container = document.getElementById("smartcloud-wpsuite-admin");
const resetContainer = document.getElementById("wpsuite-config-reset");
if (resetContainer) {
  createRoot(resetContainer).render(<StrictMode><MantineProvider theme={theme}><ResetSettings endpoint={resetContainer.dataset.resetUrl} nonce={resetContainer.dataset.restNonce} /></MantineProvider></StrictMode>);
}
if (container) {
  const root = createRoot(container);
  let content: ReactNode;
  if (view === "settings") {
    const Settings = await import("./settings");
    content = <Settings.default />;
  } else if (container.hasAttribute("data-navigation")) {
    const navigation = parseNavigation(container.dataset.navigation ?? "");
    content = navigation
      ? <NavigationPages navigation={navigation} />
      : <Text p="md">{__("WP Suite navigation could not be loaded. Reload this page or open the plugin from the WordPress menu.", TEXT_DOMAIN)}</Text>;
  } else {
    // Older hub PHP does not supply navigation: retain its connection screen.
    content = <Main {...wpsuite} />;
  }
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MantineProvider theme={theme}>
          <Notifications position="top-right" zIndex={100002} />
          <ModalsProvider modalProps={{ zIndex: 100001 }}>
            {content}
          </ModalsProvider>
        </MantineProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
