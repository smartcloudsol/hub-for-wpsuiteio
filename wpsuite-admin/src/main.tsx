import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Amplify } from "aws-amplify";
import { Hub } from "aws-amplify/utils";
import { fetchAuthSession } from "@aws-amplify/auth";
import { Authenticator } from "@aws-amplify/ui-react";

import { __experimentalHeading as Heading } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

import { DEFAULT_THEME, Text, Stack } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import { TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";

import { LicenseHandler } from "./license-handler";

import "jquery";

import classes from "./main.module.css";

interface MainProps {
  nonce: string;
}

const production = process.env?.NODE_ENV === "production";

const apiUrl =
  !production || window.location.host === "dev.wpsuite.io"
    ? "https://api.wpsuite.io/dev"
    : "https://api.wpsuite.io";

const configUrl =
  !production || window.location.host === "dev.wpsuite.io"
    ? "https://wpsuite.io/static/config/dev.json"
    : "https://wpsuite.io/static/config/prod.json";

const Main = (props: MainProps) => {
  const { nonce } = props;

  const [ownedAccountId, setOwnedAccountId] = useState<string>();
  const [accountId, setAccountId] = useState<string | undefined>(
    WpSuite.siteSettings.accountId
  );
  const [siteId, setSiteId] = useState<string | undefined>(
    WpSuite.siteSettings.siteId
  );
  const [siteKey, setSiteKey] = useState<string | undefined>(
    WpSuite.siteSettings.siteKey
  );
  const [amplifyConfigured, setAmplifyConfigured] = useState<
    boolean | undefined
  >();

  const isMobile = useMediaQuery(
    `(max-width: ${DEFAULT_THEME.breakpoints.sm})`
  );

  const { data: configuration, error: configurationError } = useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const response = await fetch(configUrl).catch((err) => {
        return {
          ok: true,
          statusText: err.message,
          json: async () => ({
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
          }),
        };
      });

      if (!response.ok) {
        throw new Error(response.statusText);
      }

      return response.json();
    },
  });

  const checkAccount = useCallback(async () => {
    try {
      const authSession = await fetchAuthSession();
      const scopes =
        authSession.tokens?.accessToken.payload["scope"]?.split(" ") ?? [];
      setOwnedAccountId(undefined);
      if (
        accountId &&
        !scopes.includes("sc.account.owner." + accountId) &&
        !scopes.includes("sc.account.admin." + accountId)
      ) {
        console.error(
          "You do not have permission to access this resource. Please contact site owner."
        );
        const accId = scopes
          .find(
            (scope) =>
              scope.startsWith("sc.account.owner.") ||
              scope.startsWith("sc.account.admin.")
          )
          ?.split(".")[3];

        if (accId) {
          setOwnedAccountId(accId);
        }
      }
    } catch (err) {
      console.error(err);
      setOwnedAccountId(undefined);
    }
  }, [accountId]);

  useEffect(() => {
    if (!amplifyConfigured) {
      if (
        configuration?.userPoolId &&
        configuration?.appClientPlugin &&
        configuration?.identityPoolId
      ) {
        const rc = {
          Auth: {
            Cognito: {
              userPoolId: configuration.userPoolId,
              userPoolClientId: configuration.appClientPlugin,
              identityPoolId: configuration.identityPoolId,
            },
          },
          API: {
            REST: {
              backend: {
                endpoint: apiUrl,
              },
              backendWithIam: {
                endpoint: apiUrl,
              },
            },
          },
        };
        const los: Record<string, unknown> = {
          API: {
            REST: {
              headers: async (options: { apiName: string }) => {
                if (options.apiName === "backend") {
                  try {
                    const authSession = await fetchAuthSession();
                    if (authSession?.tokens?.accessToken) {
                      return {
                        Authorization: `Bearer ${authSession.tokens.accessToken}`,
                      };
                    }
                  } catch (err) {
                    console.error(err);
                  }
                }
                return {};
              },
            },
          },
        };
        Amplify.configure(rc, los);
        checkAccount();
        setAmplifyConfigured(true);
      } else if (configurationError) {
        console.error("Error loading configuration:", configurationError);
        setAmplifyConfigured(false);
      }
    }
  }, [
    configuration,
    props,
    amplifyConfigured,
    checkAccount,
    configurationError,
  ]);

  useEffect(() => {
    const stopCb = Hub.listen("auth", (data) => {
      const { payload } = data;
      if (payload.event === "signedIn" || payload.event === "signedOut") {
        checkAccount();
      }
    });
    return () => {
      stopCb();
    };
  }, [checkAccount]);

  return (
    amplifyConfigured !== undefined && (
      <Authenticator.Provider>
        <div className={classes["wpc-container"]}>
          <Stack mb="md" gap={4}>
            <Heading
              level={1}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: "#218BE6",
              }}
            >
              {__(
                isMobile
                  ? "WPSuite.io HUB"
                  : "Central Hub for WPSuite.io Plugins",
                TEXT_DOMAIN
              )}
            </Heading>
            <Text>
              Link this WordPress installation to your WP Suite workspace to
              enable licensing and shared features. You can disconnect or switch
              workspaces at any time without affecting your content.
            </Text>
          </Stack>{" "}
          <LicenseHandler
            apiUrl={apiUrl}
            amplifyConfigured={amplifyConfigured}
            nonce={nonce}
            stripePublicKey={configuration?.stripePublicKey}
            pricingTable={configuration?.pricingTable}
            accountId={accountId}
            ownedAccountId={ownedAccountId ?? accountId}
            siteId={siteId}
            siteKey={siteKey}
            setAccountId={setAccountId}
            setSiteId={setSiteId}
            setSiteKey={setSiteKey}
          />
        </div>
      </Authenticator.Provider>
    )
  );
};

export default Main;
