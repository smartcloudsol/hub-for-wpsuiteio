import { MantineProvider, createTheme } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { getWpSuite } from "@smart-cloud/wpsuite-core";

const production = process.env?.NODE_ENV === "production";
if (!production) {
  import("./index.css");
}

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
const root = createRoot(document.getElementById("wpsuite-admin")!);
if (view === "diagnostics") {
  const Diagnostics = await import("./diagnostics");
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MantineProvider theme={theme}>
          <Notifications position="top-right" zIndex={100002} />
          <ModalsProvider modalProps={{ zIndex: 100001 }}>
            <Diagnostics.default />
          </ModalsProvider>
        </MantineProvider>
      </QueryClientProvider>
    </StrictMode>
  );
} else {
  const Main = await import("./main");
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MantineProvider theme={theme}>
          <Notifications position="top-right" zIndex={100002} />
          <ModalsProvider modalProps={{ zIndex: 100001 }}>
            <Main.default {...wpsuite} />
          </ModalsProvider>
        </MantineProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
