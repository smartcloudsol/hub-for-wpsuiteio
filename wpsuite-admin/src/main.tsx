import { fetchAuthSession } from "@aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "@aws-amplify/auth/cognito";
import { useQuery } from "@tanstack/react-query";
import { Amplify } from "aws-amplify";
import { Hub } from "aws-amplify/utils";
import { useCallback, useEffect, useState, type ElementType } from "react";

import { __experimentalHeading as Heading } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

import {
  Anchor,
  Button,
  DEFAULT_THEME,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import {
  getWpSuite,
  resolveWorkspaceId,
  workspaceManagementIds,
  TEXT_DOMAIN,
  createBackendProfileStorage,
  getBackendProfileContext,
} from "@smart-cloud/wpsuite-core";

import { LicenseHandler } from "./license-handler";
import { BackendProfiles } from "./backend-profiles";
import {
  fetchPlatformConfiguration,
  platformRestOptions,
  resolvePlatformConnection,
  validatePlatformConfiguration,
} from "./platform-connection";

import "jquery";

import classes from "./main.module.css";
import type { NavigationLink } from "./navigation";

interface MainProps {
  nonce?: string;
  embedded?: boolean;
  platformLinks?: NavigationLink[];
}

const production = process.env?.NODE_ENV === "production";

const legacyApiUrl =
  !production || window.location.host === "dev.wpsuite.io"
    ? "https://api-dev.wpsuite.io"
    : "https://api.wpsuite.io";

const legacyConfigUrl =
  !production || window.location.host === "dev.wpsuite.io"
    ? "https://wpsuite.io/static/config/dev.json"
    : "https://wpsuite.io/static/config/prod.json";

const wpsuite = getWpSuite();
const HeadingComponent = Heading as unknown as ElementType;

const Main = (props: MainProps) => {
  const { nonce, embedded = false, platformLinks = [] } = props;
  const compact =
    embedded &&
    Boolean(
      resolveWorkspaceId(wpsuite?.siteSettings) && wpsuite?.siteSettings.siteId,
    );
  const [platformBinding] = useState(() => {
    try {
      return {
        connection: resolvePlatformConnection(
          wpsuite?.siteSettings,
          legacyApiUrl,
          legacyConfigUrl,
        ),
      };
    } catch (error) {
      return { error };
    }
  });
  const apiUrl = platformBinding.connection?.apiBaseUrl ?? "";

  const [amplifyConfigured, setAmplifyConfigured] = useState<
    boolean | undefined
  >();
  const [ownAccountId, setOwnAccountId] = useState<string>();
  const [accountId, setAccountId] = useState<string | undefined>(
    resolveWorkspaceId(wpsuite!.siteSettings),
  );
  const [siteId, setSiteId] = useState<string | undefined>(
    wpsuite!.siteSettings.siteId,
  );
  const [siteKey, setSiteKey] = useState<string | undefined>(
    wpsuite!.siteSettings.siteKey,
  );

  const isMobile = useMediaQuery(
    `(max-width: ${DEFAULT_THEME.breakpoints.sm})`,
  );

  const { data: configuration } = useQuery({
    queryKey: ["config", platformBinding.connection?.configUrl, apiUrl],
    queryFn: async () => {
      try {
        const connection = platformBinding.connection;
        if (!connection) throw platformBinding.error;
        const response = await fetchPlatformConfiguration(connection, () => ({
          config: "prod",
          baseUrl: "https://wpsuite.io",
          userPoolId: "us-east-1_G0wEwK9tt",
          identityPoolId: "us-east-1:11e55c9a-b768-48a2-8a0c-c51f1e99c129",
          appClientPlugin: "5e6fs3pk1k1ju7cgpnp7o7si8u",
          awsRegion: "us-east-1",
          pricingTable: "prctbl_1QA6TQFjw5MDUzy6c3fBSPGL",
          stripePublicKey:
            "pk_live_51OVeJwFjw5MDUzy6pwTbsMjcBZjZioihzLAtxQsF91u4lYJC4mtqrJddSskhz6OPbWS0tr8XL2G1AwJaXEpv9Rgn008dAz5TEr",
          permissions: {
            owner: [
              "transfer-account",
              "manage-account",
              "manage-sites",
              "manage-subscriptions",
              "manage-billing",
            ],
            admin: [
              "manage-account",
              "manage-sites",
              "manage-subscriptions",
              "manage-billing",
            ],
            accountant: ["manage-billing"],
          },
        }));
        if (!response.ok) {
          console.error("Error loading configuration:", await response.json());
          setAmplifyConfigured(false);
          throw new Error(response.statusText);
        }

        const result = await response.json();
        validatePlatformConfiguration(connection, result);
        const rc = {
          Auth: {
            Cognito: {
              userPoolId: result.userPoolId,
              userPoolClientId: result.appClientPlugin,
              identityPoolId: result.identityPoolId,
            },
          },
          API: {
            REST: {
              backend: {
                endpoint: apiUrl,
              },
              backendWithIam: {
                endpoint: apiUrl,
                region: result.foundationApiRegion ?? result.awsRegion,
              },
            },
          },
        };
        const los: Record<string, unknown> = {
          API: {
            REST: platformRestOptions(connection, fetchAuthSession, (error) => {
              console.error(error);
            }),
          },
        };
        const storage = getBackendProfileContext() ? createBackendProfileStorage(window.localStorage) : undefined;
        if (storage) cognitoUserPoolsTokenProvider.setKeyValueStorage(storage);
        Amplify.configure(rc, los);
        await checkAccount();
        setAmplifyConfigured(true);
        return result;
      } catch (error) {
        setAmplifyConfigured(false);
        throw error;
      }
    },
  });

  const checkAccount = useCallback(async () => {
    try {
      const authSession = await fetchAuthSession();
      const scopes =
        authSession.tokens?.accessToken.payload["scope"]?.split(" ") ?? [];
      setOwnAccountId(undefined);
      const managedWorkspaces = workspaceManagementIds(scopes);
      if (accountId && !managedWorkspaces.includes(accountId)) {
        console.error(
          "You do not have permission to access this resource. Please contact site owner.",
        );
        const accId = managedWorkspaces[0];

        if (accId) {
          setOwnAccountId(accId);
        }
      }
    } catch (err) {
      console.error(err);
      setOwnAccountId(undefined);
    }
  }, [accountId]);

  useEffect(() => {
    if (amplifyConfigured !== true) return;
    const stopCb = Hub.listen("auth", (data) => {
      const { payload } = data;
      if (payload.event === "signedIn" || payload.event === "signedOut") {
        checkAccount();
      }
    });
    return () => {
      stopCb();
    };
  }, [checkAccount, amplifyConfigured]);

  return (
    <div
      className={embedded ? classes["wpc-embedded"] : classes["wpc-container"]}
    >
      <BackendProfiles nonce={nonce} />
      {!compact && (
        <Stack mb="md" gap={4}>
          <HeadingComponent
            level={embedded ? 2 : 1}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "#218BE6",
            }}
          >
            {embedded
              ? __("WP Suite site connection", TEXT_DOMAIN)
              : __(
                  isMobile ? "WPSuite" : "WPSuite Site Connection",
                  TEXT_DOMAIN,
                )}
          </HeadingComponent>
          {embedded ? (
            <Text>
              {__(
                "Connect this site to manage Pro configuration. Other tools work without a connection.",
                TEXT_DOMAIN,
              )}
            </Text>
          ) : (
            <>
              <Text>
                <strong>WPSuite</strong> is a commercial platform developed by{" "}
                <strong>Smart Cloud Solutions, Inc</strong>. Connecting your
                site lets SmartCloud plugins store and load Pro feature
                configuration (for example, API, chatbot, or feature settings)
                from your WPSuite workspace.
              </Text>
              <Text>
                After connecting, you can{" "}
                <strong>preview and try Pro features in WP Admin</strong> before
                enabling them on your live site. You can disconnect or switch
                sites at any time.
              </Text>
              <Text>
                Learn more about the WPSuite platform, documentation, and
                updates at{" "}
                <Anchor
                  href="https://wpsuite.io"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  https://wpsuite.io
                </Anchor>
                .
              </Text>
            </>
          )}
        </Stack>
      )}
      {amplifyConfigured === false &&
      (!platformBinding.connection || platformBinding.connection.explicit) ? (
        <Text role="alert" c="red">
          {__(
            "The platform connection is unavailable. Check the site connection settings or try again later.",
            TEXT_DOMAIN,
          )}
        </Text>
      ) : (
        <LicenseHandler
          apiUrl={apiUrl}
          amplifyConfigured={amplifyConfigured}
          nonce={nonce}
          stripePublicKey={configuration?.stripePublicKey}
          pricingTable={configuration?.pricingTable}
          accountId={accountId}
          ownAccountId={ownAccountId ?? accountId}
          siteId={siteId}
          siteKey={siteKey}
          setAccountId={setAccountId}
          setSiteId={setSiteId}
          setSiteKey={setSiteKey}
          compact={compact}
          platformLinks={embedded ? platformLinks : []}
        />
      )}
      {embedded && !compact && platformLinks.length > 0 && (
        <Group mt="md">
          {platformLinks.map((link) => (
            <Button
              key={link.url}
              component="a"
              href={link.url}
              variant="default"
            >
              {link.label}
            </Button>
          ))}
        </Group>
      )}
      {!compact && (
        <Text c="dimmed" size="xs" mt="md" fs="italic">
          WPSuite.io is a commercial platform by Smart Cloud Solutions, Inc. and
          is not affiliated with or endorsed by WordPress.org.
        </Text>
      )}
    </div>
  );
};

export default Main;
