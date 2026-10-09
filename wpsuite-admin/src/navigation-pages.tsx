import ResetSettings from "./reset-settings";
import {
  Anchor,
  Badge,
  Button,
  Card,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { lazy, Suspense } from "react";
import { __, sprintf } from "@wordpress/i18n";
import { getWpSuite, TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";

import Main from "./main";
import ProductPage from "./product-page";
import ToolStatus, { ToolAction } from "./tool-status";
import CapabilitySurfacePage, { AdvancedResources } from "./capability-surface";
import { type NavigationBootstrap } from "./navigation";
import classes from "./main.module.css";
import BackendReadiness from "./backend-readiness";

const PlatformSettings = lazy(() => import("./settings"));

function toolProduct(id: string, fallback: string): string {
  const products: Record<string, string> = {
    answers: "AI-Kit",
    "ai-tools": "AI-Kit",
    "ai-editing": "Agent Composer",
    "login-access": "Gatey",
    "forms-workflows": "Flow",
    "static-publishing": "Static Publisher",
  };
  return sprintf(__("Powered by %s", TEXT_DOMAIN), products[id] ?? fallback);
}

function toolAction(id: string, label: string): string {
  return id === "login-access" || id === "consent" || id === "content-relations"
    ? sprintf(__("Manage %s", TEXT_DOMAIN), label)
    : sprintf(__("Open %s", TEXT_DOMAIN), label);
}

export default function NavigationPages({
  navigation,
}: {
  navigation: NavigationBootstrap;
}) {
  const { view } = navigation;
  const capability = navigation.capabilities.find(
    (item) => item.id === navigation.active_id,
  );
  const wpsuite = getWpSuite();

  return (
    <div className={classes["wpc-container"]}>
      <Stack gap="xl">
        {view === "overview" && (
          <>
            <Stack gap="xs">
              <Title order={1}>{__("WP Suite", TEXT_DOMAIN)}</Title>
              <Text c="dimmed">
                {__(
                  "Manage what WP Suite does on this WordPress site.",
                  TEXT_DOMAIN,
                )}
              </Text>
            </Stack>
            {navigation.can_manage_connection && (
              <section aria-label={__("Site connection", TEXT_DOMAIN)}>
                <Main
                  {...wpsuite}
                  embedded
                  platformLinks={navigation.platform_links}
                />
              </section>
            )}
            <section aria-labelledby="wpsuite-installed-title">
              <Title order={2} id="wpsuite-installed-title" mb="md">
                {__("Tools on this site", TEXT_DOMAIN)}
              </Title>
              {navigation.capabilities.length === 0 && (
                <Text c="dimmed">
                  {__(
                    "No tools are available for your current permissions.",
                    TEXT_DOMAIN,
                  )}
                </Text>
              )}
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} verticalSpacing="sm">
                {navigation.capabilities
                  .filter((item) => item.show_in_overview !== false)
                  .map((item) => (
                    <div key={item.id} className={classes["installed-tool"]} data-backend={item.id === "answers" || item.id === "forms-workflows" ? "true" : undefined}>
                      <Card withBorder radius="md" padding="lg">
                        <Stack h="100%" gap="sm">
                          <Title order={3}>
                            <Anchor href={item.url} inherit>
                              {item.label}
                            </Anchor>
                          </Title>
                          <Text size="xs" c="dimmed" fs="italic">
                            {toolProduct(item.id, item.product)}
                          </Text>
                          <Text size="sm" style={{ flexGrow: 1 }}>
                            {item.description}
                          </Text>
                          {item.surface_url ? (
                            <ToolStatus
                              endpoint={item.surface_url}
                              nonce={navigation.rest_nonce}
                              toolId={item.id}
                              action={{ url: item.url, label: toolAction(item.id, item.label), setupLabel: sprintf(__("Set up %s", TEXT_DOMAIN), item.label) }}
                            />
                          ) : (
                            <ToolAction action={{ url: item.url, label: toolAction(item.id, item.label), setupLabel: sprintf(__("Set up %s", TEXT_DOMAIN), item.label) }} />
                          )}
                        </Stack>
                      </Card>
                      {(item.id === "answers" || item.id === "forms-workflows") && <BackendReadiness id={item.id} compact />}
                    </div>
                  ))}
              </SimpleGrid>
            </section>

            {navigation.discovery.length > 0 && (
              <section aria-labelledby="wpsuite-discovery-title">
                <Title order={2} id="wpsuite-discovery-title" mb="xs">
                  {__("More tools", TEXT_DOMAIN)}
                </Title>
                <Text c="dimmed" size="sm" mb="md">
                  {__(
                    "Explore additional WP Suite plugins for your site.",
                    TEXT_DOMAIN,
                  )}
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                  {navigation.discovery.map((item) => (
                    <Card key={item.id} withBorder radius="md" padding="lg">
                      <Stack gap="sm" h="100%">
                        <Title order={3}>{item.label}</Title>
                        <Text size="xs" c="dimmed" fs="italic">
                          {toolProduct(item.id, item.product)}
                        </Text>
                        <Badge color="gray" variant="light">
                          {item.state === "not_installed"
                            ? __("Not installed", TEXT_DOMAIN)
                            : item.state === "inactive"
                            ? __("Inactive", TEXT_DOMAIN)
                            : __("Existing plugin", TEXT_DOMAIN)}
                        </Badge>
                        <Text size="sm" style={{ flexGrow: 1 }}>
                          {item.description}
                        </Text>
                        {item.message && (
                          <Text size="sm" c="dimmed">
                            {item.message}
                          </Text>
                        )}
                        {item.action && (
                          <Anchor href={item.action.url}>
                            {item.action.label}
                          </Anchor>
                        )}
                      </Stack>
                    </Card>
                  ))}
                </SimpleGrid>
              </section>
            )}
          </>
        )}

        {view === "advanced" &&
          (navigation.can_manage_connection ? (
            <Suspense
              fallback={
                <Text role="status">
                  {__("Loading settings…", TEXT_DOMAIN)}
                </Text>
              }
            >
              <PlatformSettings />
            </Suspense>
          ) : (
            <Text>
              {__(
                "Platform Settings are available to site administrators.",
                TEXT_DOMAIN,
              )}
            </Text>
          ))}

        {view === "capability" &&
          (capability ? (
            <>
              <Stack gap="xs">
                <Title order={1}>{capability.label}</Title>
                <Text c="dimmed" size="xs" fs="italic">
                  {toolProduct(capability.id, capability.product)}
                </Text>
                <Text>{capability.description}</Text>
              </Stack>
              {capability.surface_url &&
                (capability.has_details ? (
                  <ProductPage backendId={capability.id === "answers" || capability.id === "forms-workflows" ? capability.id : undefined}>
                    <CapabilitySurfacePage
                      key={capability.id}
                      backendId={capability.id === "answers" || capability.id === "forms-workflows" ? capability.id : undefined}
                      endpoint={capability.surface_url}
                      resetEndpoint={capability.reset_url}
                      nonce={navigation.rest_nonce}
                      extensionId={capability.surface_extension}
                      integrated
                      registrationLinks={[
                        ...capability.quick_links,
                        ...capability.advanced_links,
                      ]}
                    />
                  </ProductPage>
                ) : (
                  <CapabilitySurfacePage
                    key={capability.id}
                    backendId={capability.id === "answers" || capability.id === "forms-workflows" ? capability.id : undefined}
                    endpoint={capability.surface_url}
                    resetEndpoint={capability.reset_url}
                    nonce={navigation.rest_nonce}
                    extensionId={capability.surface_extension}
                    registrationLinks={[
                      ...capability.quick_links,
                      ...capability.advanced_links,
                    ]}
                  />
                ))}
              {!capability.surface_url && capability.primary && (
                <Button
                  component="a"
                  href={capability.primary.url}
                  style={{ alignSelf: "flex-start" }}
                >
                  {capability.primary.label}
                </Button>
              )}
              {!capability.surface_url && (
                <ResetSettings endpoint={capability.reset_url} nonce={navigation.rest_nonce} />
              )}
              {!capability.surface_url && (
                <AdvancedResources
                  links={[
                    ...capability.quick_links,
                    ...capability.advanced_links,
                  ]}
                />
              )}
            </>
          ) : (
            <Text>
              {__(
                "This tool is not available for your current permissions.",
                TEXT_DOMAIN,
              )}
            </Text>
          ))}
      </Stack>
    </div>
  );
}
