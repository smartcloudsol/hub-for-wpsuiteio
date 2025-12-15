import { get, patch } from "@aws-amplify/api";
import { fetchUserAttributes } from "@aws-amplify/auth";
import {
  Authenticator,
  Heading,
  useAuthenticator,
} from "@aws-amplify/ui-react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  DEFAULT_THEME,
  Flex,
  Grid,
  Group,
  HoverCard,
  List,
  LoadingOverlay,
  Menu,
  Modal,
  Pagination,
  Radio,
  rem,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  useModalsStack,
  VisuallyHidden,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  useDebouncedValue,
  useMediaQuery,
  useViewportSize,
} from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  getConfig,
  TEXT_DOMAIN,
  type SiteSettings,
  type SubscriptionType,
} from "@smart-cloud/wpsuite-core";
import {
  IconAlertCircle,
  IconArrowsUp,
  IconCancel,
  IconCheck,
  IconClearAll,
  IconCreditCard,
  IconEdit,
  IconInfoCircle,
  IconLink,
  IconLogin,
  IconLogout,
  IconMoneybagHeart,
  IconPlus,
  IconReload,
  IconSettings,
  IconTrash,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { __ } from "@wordpress/i18n";
import * as API from "aws-amplify/api";
import { zod4Resolver } from "mantine-form-zod-resolver";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FunctionComponent,
} from "react";
import { z } from "zod";
import { type LicenseHandlerProps } from "./index";
import classes from "./settings.module.css";
import { EmailSkeleton, FullSkeleton } from "./skeletons";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "stripe-pricing-table": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

interface ListPage<T> {
  lastKey?: never;
  list: T[];
}

interface Account {
  accountId: string;
  name: string;
  owner: string;
  ownerEmail: string;
  customerId?: string;
  customer: unknown;
}

export interface Site {
  accountId: string;
  siteId: string;
  siteKey?: string;
  name: string;
  domain: string;
  subscriptionType?: SubscriptionType;
  subscription?: {
    id: string;
    active: boolean;
    currentPeriodStart: number;
    currentPeriodEnd: number;
    cancelAtPeriodEnd: boolean;
    subscriptionScheduleId?: string;
    nextSubscriptionType?: SubscriptionType;
  };
  settings: Record<string, unknown> | null;
  account?: Account;
}

export interface SettingsProps extends LicenseHandlerProps {
  apiUrl: string;
  stripePublicKey: string;
  pricingTable: string;
  nonce: string;
}

const PAGE_SIZE = 3;

export const Settings: FunctionComponent<SettingsProps> = (
  props: SettingsProps
) => {
  const {
    amplifyConfigured,
    apiUrl,
    ownAccountId,
    accountId,
    siteId,
    siteKey,
    nonce,
    setAccountId,
    setSiteId,
    setSiteKey,
  } = props;
  const [
    creatingUpdateSubscriptionSession,
    setCreatingUpdateSubscriptionSession,
  ] = useState<"update" | "manage">();
  const [mutatingSubscription, setMutatingSubscription] = useState<
    "cancel" | "cancel_schedule" | "renew"
  >();

  const { authStatus, toSignIn, signOut } = useAuthenticator((context) => [
    context.user,
    context.authStatus,
    context.route,
  ]);
  const loadSiteEnabled =
    !!accountId && !!siteId && (authStatus === "authenticated" || !!siteKey);

  const [email, setEmail] = useState<string>();
  const [customerId, setCustomerId] = useState<string | null>();
  const [clientSecret, setClientSecret] = useState<string | null>();
  const [site, setSite] = useState<Site | null | undefined>(
    loadSiteEnabled ? undefined : null
  );
  const [subscription, setSubscription] = useState<
    Site["subscription"] | null | undefined
  >(accountId || siteId ? undefined : null);
  const [subscriptionType, setSubscriptionType] = useState<
    SubscriptionType | null | undefined
  >(accountId || siteId ? undefined : null);

  const isMobile = useMediaQuery(
    `(max-width: ${DEFAULT_THEME.breakpoints.sm})`
  );
  const { width: vw } = useViewportSize();
  const dropdownWidth = Math.min(300, vw - parseInt(rem(32)));

  const stack = useModalsStack(["connect-your-site", "prices"]);

  const queryClient = useQueryClient();

  const cancelOrNewSubscription = useMutation({
    mutationFn: ({
      site,
      action,
    }: {
      site: Site;
      action: "cancel" | "cancel_schedule" | "renew";
    }) => {
      setMutatingSubscription(action);
      return patch({
        apiName: "backend",
        path: "/account/" + site.accountId + "/site/" + site.siteId,
        options: /*permissions?.has("manage-subscriptions")
            ?*/ {
          queryParams: {
            action,
          },
        },
        /*: {}*/
      })
        .response.then((response) => response.body.json())
        .then((result) => {
          notifications.show({
            title: __("Subscription changed", TEXT_DOMAIN),
            message: __("Subscription changed successfully.", TEXT_DOMAIN),
            color: "green",
            icon: <IconMoneybagHeart />,
            className: classes["notification"],
          });
          return result as unknown as Site;
        })
        .catch((err) => {
          console.error("Error:", (err as Error).message);
          notifications.show({
            title: __("Error occured", TEXT_DOMAIN),
            message: (err as Error).message,
            color: "red",
            icon: <IconAlertCircle />,
            className: classes["notification"],
          });
          setClientSecret(null);
        })
        .finally(() => {
          setMutatingSubscription(undefined);
        });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["site", accountId, siteId],
      });
    },
  });

  const openPricingTable = useCallback(async () => {
    if (customerId) {
      get({
        apiName: "backend",
        path: `/account/${accountId}/billing-auth-session`,
      })
        .response.then((response) => response.body.json())
        .then((response) => {
          setClientSecret((response as { token: string }).token);
        })
        .catch((err) => {
          console.error("Error:", (err as Error).message);
          setClientSecret(null);
        });
    } else {
      setClientSecret(null);
    }
    stack.open("prices");
  }, [accountId, customerId, stack]);

  const openBillingPortalSession = useCallback(
    async (type?: "update") => {
      if (!subscription || creatingUpdateSubscriptionSession) {
        return;
      }
      setCreatingUpdateSubscriptionSession(type ?? "manage");
      const queryParams: {
        next_url: string;
        subscription_id: string;
        type?: "update";
      } = {
        next_url: window.location.href,
        subscription_id: subscription.id,
      };
      if (type) {
        queryParams.type = type;
      }
      await get({
        apiName: "backend",
        path: `/account/${accountId}/billing-portal-session`,
        options: {
          queryParams,
        },
      })
        .response.then((response) => response.body.json())
        .then((response) => {
          const url = (response as { url: string }).url;
          window.location.assign(url);
        })
        .catch((err) => {
          console.error("Error:", (err as Error).message);
          setCreatingUpdateSubscriptionSession(undefined);
        });
    },
    [accountId, creatingUpdateSubscriptionSession, subscription]
  );

  const openModal = useCallback(
    (site: Site, action: "cancel" | "cancel_schedule" | "renew") => {
      let buttonTitle = "Confirm";
      let description = <></>;
      switch (action) {
        case "cancel":
          buttonTitle = "Yes, Cancel";
          description = (
            <>
              <Heading level={3} marginBottom="var(--mantine-spacing-md)">
                Cancel Subscription
              </Heading>
              <Text mb="sm">
                Your subscription will be canceled, but is still available until
                the end of your billing period on{" "}
                <strong>
                  {new Date(
                    (site.subscription?.currentPeriodEnd ?? 0) * 1000
                  )?.toLocaleString("en")}
                </strong>
                . If you change your mind, you can renew your subscription.
              </Text>
              <Text fw={500}>
                Are you sure you want to cancel your subscription?
              </Text>
            </>
          );
          break;
        case "cancel_schedule":
          buttonTitle = "Yes, Cancel";
          description = (
            <>
              <Heading level={3} marginBottom="var(--mantine-spacing-md)">
                Cancel Scheduled Change
              </Heading>
              <Text mb="sm">
                If canceled, your subscription will continue with the original
                terms after{" "}
                <strong>
                  {new Date(
                    (site.subscription?.currentPeriodEnd ?? 0) * 1000
                  )?.toLocaleString("en")}
                </strong>
                .
              </Text>
              <Text fw={500}>
                Are you sure you want to cancel the scheduled change to your
                subscription?
              </Text>
            </>
          );
          break;
        case "renew":
          buttonTitle = "Yes, Renew";
          description = (
            <>
              <Heading level={3} marginBottom="var(--mantine-spacing-md)">
                Renew Subscription
              </Heading>
              <Text size="sm">
                This subscription will no longer be canceled. It will renew on{" "}
                {new Date(
                  (site.subscription?.currentPeriodEnd ?? 0) * 1000
                )?.toLocaleString("en")}
                .
              </Text>
            </>
          );
          break;
      }

      modals.openConfirmModal({
        children: description,
        labels: { confirm: buttonTitle, cancel: "No" },
        confirmProps: {
          className: classes["console-button"],
        },
        cancelProps: {
          variant: "outline",
          className: classes["console-button-outline"],
        },
        withCloseButton: false,
        onConfirm: () => cancelOrNewSubscription.mutate({ site, action }),
        zIndex: 100000,
        xOffset: "1dvh",
        yOffset: "1dvh",
        centered: true,
      });
    },
    [cancelOrNewSubscription]
  );

  const { isError: isAccountError } = useQuery({
    queryKey: ["account", accountId],
    queryFn: () =>
      fetchAccount(accountId!)
        .then((data) => {
          if (data) {
            setCustomerId(data.customer ? (data?.customerId as string) : null);
          } else if (
            authStatus === "authenticated" &&
            (!accountId || isAccountError)
          ) {
            setCustomerId(null);
          }
          return data;
        })
        .catch(() => {
          setSubscription(null);
        }),
    enabled: !!accountId && authStatus === "authenticated",
  });

  const { isError: isSiteError, isPending: isSitePending } = useQuery({
    queryKey: ["site", accountId, siteId],
    queryFn: () =>
      fetchSite(accountId!, siteId!, siteKey)
        .then((data) => {
          setSubscriptionType(data.subscriptionType ?? null);
          setSubscription(data.subscription);
          setSite(data);
          return data;
        })
        .catch((err) => {
          setSite(null);
          setSubscription(null);
          throw err;
        }),
    enabled: loadSiteEnabled,
  });

  const clearCache = useCallback(
    async (siteSettings?: SiteSettings) => {
      const subscriber = siteSettings
        ? siteSettings.subscriber
        : !!subscriptionType;
      return fetch(WpSuite.restUrl + "/update-site-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WP-Nonce": nonce,
        },
        body: JSON.stringify({
          accountId: siteSettings ? siteSettings.accountId : accountId,
          siteId: siteSettings ? siteSettings.siteId : siteId,
          siteKey: siteSettings ? siteSettings.siteKey : siteKey,
          lastUpdate: new Date().getTime(),
          subscriber,
        }),
        credentials: "same-origin",
      }).finally(() => {
        if (
          siteSettings &&
          accountId !== siteSettings.accountId &&
          siteId !== siteSettings.siteId
        ) {
          setSite(null);
          if (!siteSettings.accountId) {
            setSubscriptionType(null);
          }
          setAccountId(siteSettings.accountId);
          setSiteId(siteSettings.siteId);
          setSiteKey(siteSettings.siteKey);
        }
      });
    },
    [
      accountId,
      nonce,
      setAccountId,
      setSiteId,
      setSiteKey,
      siteId,
      siteKey,
      subscriptionType,
    ]
  );

  const saveSiteSettingsMutation = useMutation({
    mutationFn: (siteSettings: SiteSettings) => {
      return clearCache(siteSettings);
    },
    onSuccess: async (response) => {
      if (response.ok) {
        notifications.show({
          title: __("Settings saved", TEXT_DOMAIN),
          message: __("Site settings saved successfully", TEXT_DOMAIN),
          color: "green",
          icon: <IconInfoCircle />,
          className: classes["notification"],
        });
      } else {
        const err = await response.json();
        console.error("Failed to connect site", err);
        notifications.show({
          title: __("Error occured", TEXT_DOMAIN),
          message: (err as Error).message,
          color: "red",
          icon: <IconAlertCircle />,
          className: classes["notification"],
        });
      }
      stack.close("connect-your-site");
    },
    onError: (error) => {
      notifications.show({
        title: __("Error occured", TEXT_DOMAIN),
        message: (error as Error).message,
        color: "red",
        icon: <IconAlertCircle />,
        className: classes["notification"],
      });
    },
  });

  const renderSettingsPanel = useCallback(() => {
    return (
      <Menu shadow="md" width={220}>
        <Menu.Target>
          <Button
            variant="subtle"
            ml="xs"
            leftSection={<IconSettings size={16} />}
          >
            Settings
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Site</Menu.Label>
          {accountId && siteId && (site || isSiteError) ? (
            <>
              <Menu.Item
                leftSection={<IconLink size={16} />}
                onClick={() => stack.open("connect-your-site")}
              >
                Reconnect
              </Menu.Item>
              <Menu.Item
                leftSection={<IconLogout size={16} />}
                onClick={() =>
                  modals.openConfirmModal({
                    children: (
                      <>
                        <Heading
                          level={3}
                          marginBottom="var(--mantine-spacing-md)"
                        >
                          Disconnect This Site
                        </Heading>
                        <Text mb="sm">
                          Disconnecting this site will immediately remove all
                          Pro settings – including API Settings and Form-Field
                          customizations – from WordPress.
                        </Text>
                        <Text mb="sm">
                          Any active subscription tied to this site will keep
                          billing but won't deliver benefits until you
                          reconnect.
                        </Text>
                        <Text mb="sm">
                          If you later reconnect this same site, its previous
                          settings will be restored; linking a different site
                          will start with default settings.
                        </Text>
                        <Text fw={500}>
                          Are you sure you want to disconnect this site from WP
                          Suite?
                        </Text>
                      </>
                    ),
                    labels: { confirm: "Yes, Disconnect", cancel: "No" },
                    confirmProps: {
                      className: classes["console-button"],
                    },
                    cancelProps: {
                      variant: "outline",
                      className: classes["console-button-outline"],
                    },
                    withCloseButton: false,
                    onConfirm: () => clearCache({}),
                    zIndex: 100000,
                    xOffset: "1dvh",
                    yOffset: "1dvh",
                    centered: true,
                  })
                }
              >
                Disconnect
              </Menu.Item>
              <Menu.Item
                leftSection={<IconClearAll size={16} />}
                onClick={async () => {
                  try {
                    const response = await clearCache();
                    if (response.ok) {
                      notifications.show({
                        title: __("Cache cleared", TEXT_DOMAIN),
                        message: __(
                          "Front-end site configuration cleared successfully.",
                          TEXT_DOMAIN
                        ),
                        color: "green",
                        icon: <IconTrash />,
                        className: classes["notification"],
                      });
                    } else {
                      const err = await response.json();
                      console.error("Failed to submit data", err);
                      notifications.show({
                        title: __("Error occured", TEXT_DOMAIN),
                        message: (err as Error).message,
                        color: "red",
                        icon: <IconAlertCircle />,
                        className: classes["notification"],
                      });
                    }
                  } catch (error) {
                    notifications.show({
                      title: __("Error occured", TEXT_DOMAIN),
                      message: (error as Error).message,
                      color: "red",
                      icon: <IconAlertCircle />,
                      className: classes["notification"],
                    });
                  }
                }}
              >
                Clear Cache
              </Menu.Item>
              {authStatus === "authenticated" && (
                <>
                  <Menu.Divider />
                  <Menu.Label>Subscription</Menu.Label>
                  {subscriptionType === null && (
                    <Menu.Item
                      leftSection={<IconCreditCard size={16} />}
                      onClick={() => openPricingTable()}
                      disabled={ownAccountId !== accountId}
                    >
                      Plans &amp; Pricing
                    </Menu.Item>
                  )}
                  {site &&
                    subscriptionType !== null &&
                    subscription &&
                    !isAccountError && (
                      <>
                        <Menu.Item
                          leftSection={<IconCreditCard size={16} />}
                          disabled={
                            ownAccountId !== accountId ||
                            !!creatingUpdateSubscriptionSession ||
                            !!mutatingSubscription
                          }
                          onClick={() => openBillingPortalSession()}
                        >
                          Manage Billing
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconArrowsUp size={16} />}
                          disabled={
                            ownAccountId !== accountId ||
                            !!creatingUpdateSubscriptionSession ||
                            !!mutatingSubscription
                          }
                          onClick={() => openBillingPortalSession("update")}
                        >
                          Update
                        </Menu.Item>
                        {(subscription.cancelAtPeriodEnd ||
                          (subscription.nextSubscriptionType &&
                            subscription.nextSubscriptionType !==
                              subscriptionType)) && (
                          <Menu.Item
                            leftSection={<IconReload size={16} />}
                            disabled={
                              ownAccountId !== accountId ||
                              !!creatingUpdateSubscriptionSession ||
                              !!mutatingSubscription
                            }
                            onClick={() =>
                              openModal(
                                site,
                                subscription.cancelAtPeriodEnd
                                  ? "renew"
                                  : "cancel_schedule"
                              )
                            }
                          >
                            {subscription.cancelAtPeriodEnd
                              ? "Renew"
                              : "Cancel Scheduled Update"}
                          </Menu.Item>
                        )}
                        {!subscription.cancelAtPeriodEnd && (
                          <Menu.Item
                            leftSection={<IconCancel size={16} />}
                            disabled={
                              ownAccountId !== accountId ||
                              !!creatingUpdateSubscriptionSession ||
                              !!mutatingSubscription
                            }
                            onClick={() => openModal(site, "cancel")}
                          >
                            Cancel
                          </Menu.Item>
                        )}
                      </>
                    )}
                </>
              )}
            </>
          ) : (
            <Menu.Item
              leftSection={<IconLink size={16} />}
              onClick={() => stack.open("connect-your-site")}
            >
              Connect
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
    );
  }, [
    accountId,
    authStatus,
    clearCache,
    creatingUpdateSubscriptionSession,
    isAccountError,
    isSiteError,
    mutatingSubscription,
    openBillingPortalSession,
    openModal,
    openPricingTable,
    ownAccountId,
    site,
    siteId,
    stack,
    subscription,
    subscriptionType,
  ]);

  useEffect(() => {
    if (authStatus === "authenticated") {
      fetchUserAttributes().then((userAttributes) =>
        setEmail(userAttributes?.email)
      );
    }
  }, [apiUrl, authStatus]);

  useEffect(() => {
    if (accountId && siteId) {
      getConfig("wpsuite").then((config) =>
        config && (config["subscriptionType"] as SubscriptionType)
          ? setSubscriptionType(config["subscriptionType"] as SubscriptionType)
          : setSubscriptionType(null)
      );
    }
  }, [accountId, siteId]);

  useEffect(() => {
    if (authStatus === "authenticated" || authStatus === "unauthenticated") {
      queryClient.invalidateQueries({
        queryKey: ["accounts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["sites", accountId],
      });
      queryClient.invalidateQueries({
        queryKey: ["site", accountId, siteId],
      });
    }
  }, [accountId, amplifyConfigured, authStatus, queryClient, siteId]);

  return (
    <Group
      justify="space-between"
      align="stretch"
      w="100%"
      wrap="nowrap"
      style={{ flexDirection: isMobile ? "column-reverse" : "row-reverse" }}
    >
      <Modal.Stack>
        <Modal
          {...stack.register("connect-your-site")}
          withCloseButton
          size={400}
          centered
          zIndex={100000}
          title={
            <Text size="lg" fw={700}>
              Connect Your Site
            </Text>
          }
        >
          <Authenticator
            loginMechanisms={["email"]}
            signUpAttributes={["email", "family_name", "given_name"]}
            formFields={{
              signUp: {
                "custom:acknowledgement": {
                  isRequired: true,
                  label:
                    'By creating an account, you agree to our <a href="https://wpsuite.io/privacy-policy" target="_blank" rel="noopener noreferrer" class="dark-link">Privacy Policy</a> and <a href="https://wpsuite.io/terms-of-use" target="_blank" rel="noopener noreferrer" class="dark-link">Terms of Use</a>, including the binding arbitration clause and class action waiver in Section 9.2.',
                  type: "checkbox",
                },
              },
            }}
          >
            <SiteSelector
              authStatus={authStatus}
              accountId={ownAccountId ?? accountId}
              siteId={siteId}
              siteKey={siteKey}
              subscriber={!!subscriptionType}
              onClose={() => stack.close("connect-your-site")}
              onConnect={(siteSettings: SiteSettings) => {
                return new Promise((resolve) => {
                  saveSiteSettingsMutation.mutate(siteSettings, {
                    onSettled: () => resolve(),
                  });
                });
              }}
            />
          </Authenticator>
        </Modal>
        <Modal
          {...stack.register("prices")}
          withCloseButton
          size="xl"
          zIndex={100000}
          centered
          title={
            <Text size="lg" fw={700}>
              Plans and Pricing
            </Text>
          }
          onClose={() => {
            setClientSecret(undefined);
            stack.close("prices");
          }}
        >
          {clientSecret !== undefined &&
            email !== undefined &&
            accountId &&
            siteId && (
              <Group justify="center" mt={20}>
                <Stack w="100%" gap={20}>
                  <Text>Choose the plan that fits your WordPress site!</Text>
                  <Text size="sm">
                    Start free with WP Suite core features. Upgrade to Pro to
                    unlock advanced customization, integrations, and premium
                    support across all WP Suite plugins.{" "}
                    <a className="dark-link" href="/pricing/">
                      Pricing
                    </a>{" "}
                    page.
                  </Text>
                  {clientSecret ? (
                    <stripe-pricing-table
                      pricing-table-id={props.pricingTable}
                      publishable-key={props.stripePublicKey}
                      client-reference-id={accountId + "-" + siteId}
                      customer-session-client-secret={clientSecret}
                    />
                  ) : (
                    <stripe-pricing-table
                      pricing-table-id={props.pricingTable}
                      publishable-key={props.stripePublicKey}
                      client-reference-id={accountId + "-" + siteId}
                      customer-email={email}
                    />
                  )}
                  <Group align="center" className={classes.info}>
                    <Flex
                      align="start"
                      direction="column"
                      className={classes.text}
                      gap={{ base: 10, sm: 0 }}
                    >
                      <Title order={5}>Additional Information</Title>
                      <List spacing="xs" size="xs">
                        <List.Item className={classes.item}>
                          All prices are net amounts. Applicable taxes (e.g.,
                          VAT, Sales Tax) may be added depending on your
                          location and circumstances.
                        </List.Item>
                      </List>
                    </Flex>
                  </Group>
                </Stack>
              </Group>
            )}
        </Modal>
      </Modal.Stack>
      {authStatus === "configuring" && <FullSkeleton />}
      {authStatus === "unauthenticated" && (
        <Card
          p="sm"
          withBorder
          w={{ base: "100%", sm: "40%" }}
          maw={{ base: "100%", sm: 300 }}
        >
          <Group style={{ borderBottom: "1px solid #e0e0e0" }} mb="md">
            <Text fw={500}>Account Information</Text>
          </Group>
          <Group gap="xs" style={{ justifyContent: "space-between" }}>
            <Group gap="xs">
              <IconUser size={16} />
              <Text size="sm">You are not signed in.</Text>
            </Group>
            <Button
              variant={accountId && siteId ? "outline" : "gradient"}
              leftSection={<IconLogin size={16} />}
              onClick={() => {
                toSignIn();
                stack.open("connect-your-site");
              }}
              disabled={!amplifyConfigured}
            >
              Sign In {accountId && siteId ? "to Reconnect" : "and Connect"}{" "}
              Your Site
            </Button>
            {!amplifyConfigured && (
              <HoverCard>
                <HoverCard.Target>
                  <ActionIcon variant="subtle" size="xs">
                    <IconAlertCircle size={16} color="red" />
                  </ActionIcon>
                </HoverCard.Target>
                <HoverCard.Dropdown maw={300} style={{ zIndex: 100000 }}>
                  <Text size="sm">
                    🛑 <strong>Heads-up</strong>: Configuration is temporarily
                    unavailable. Please try again later — no action is needed on
                    your side.
                  </Text>
                </HoverCard.Dropdown>
              </HoverCard>
            )}
          </Group>
        </Card>
      )}

      {authStatus === "authenticated" && (
        <Card
          p="sm"
          withBorder
          w={{ base: "100%", sm: "40%" }}
          maw={{ base: "100%", sm: 300 }}
        >
          <Group style={{ borderBottom: "1px solid #e0e0e0" }} mb="md">
            <Text fw={500}>Account Information</Text>
          </Group>
          {subscriptionType !== undefined &&
            subscriptionType !== null &&
            !subscription &&
            ((isAccountError && (
              <Alert
                color="red"
                title="Notice – Limited functionality due to network error"
                icon={<IconAlertCircle />}
                w="100%"
              >
                <Text size="sm" mb="xs">
                  You’re logged in to WordPress as an admin, but configuration
                  and PRO features are currently unavailable. Please try again
                  later — no action is needed on your side.
                </Text>
              </Alert>
            )) ||
              (((!isSitePending && !siteId) || isSiteError) && (
                <Alert
                  color="red"
                  title="Access denied – You don’t have access to this site’s PRO configuration"
                  icon={<IconAlertCircle />}
                  w="100%"
                >
                  <Text size="sm" mb="xs">
                    You’re logged in to WordPress as an admin, but the Gatey
                    account you used isn’t on the allowed members list for this
                    connected site.
                  </Text>
                </Alert>
              )))}

          <Group gap="xs" style={{ justifyContent: "space-between" }}>
            {!email && (
              <>
                <Skeleton height={24} circle />
                <EmailSkeleton />
              </>
            )}
            {email && (
              <Flex gap="xs" p="sm" align="center">
                <IconUser size={16} />
                <Text size="sm">{email}</Text>
              </Flex>
            )}
            <Button
              variant="outline"
              onClick={() => {
                signOut();
                setCustomerId(null);
              }}
              leftSection={<IconLogout size={16} />}
            >
              Sign Out
            </Button>
          </Group>
        </Card>
      )}
      <Card
        p="sm"
        withBorder
        w={{ base: "100%", sm: "auto" }}
        style={{ flexGrow: 1 }}
      >
        <Group style={{ borderBottom: "1px solid #e0e0e0" }} mb="md">
          <Text fw={500}>Site Details</Text>
        </Group>
        <Grid align="center" style={{ justifyContent: "space-between" }}>
          <Grid.Col span={{ base: 12, sm: 2 }}>
            Status{" "}
            {isMobile && (
              <Skeleton
                display="inline-grid"
                w="fit-content"
                visible={site === undefined && isSitePending}
              >
                {accountId && siteId && !isSiteError ? (
                  <Badge color="green" miw={100}>
                    Connected
                  </Badge>
                ) : (
                  <Badge color="grey" miw={120}>
                    {accountId && siteId
                      ? "Connected (unreachable)"
                      : "Not connected"}
                  </Badge>
                )}
              </Skeleton>
            )}
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 10 }}>
            <Flex
              direction={{ base: "column", sm: "row" }}
              gap="sm"
              align="center"
            >
              {!isMobile && (
                <Skeleton
                  display="inline-grid"
                  w="fit-content"
                  visible={site === undefined && isSitePending}
                >
                  {accountId && siteId && !isSiteError ? (
                    <Badge color="green" miw={100}>
                      Connected
                    </Badge>
                  ) : (
                    <Badge color="grey" miw={120}>
                      {accountId && siteId
                        ? "Connected (unreachable)"
                        : "Not connected"}
                    </Badge>
                  )}
                </Skeleton>
              )}
              {site && (
                <Skeleton
                  w="100%"
                  visible={site === undefined && isSitePending}
                >
                  <Flex
                    bg="gray.0"
                    align="center"
                    p="sm"
                    style={{ borderRadius: 6 }}
                  >
                    {site && (
                      <>
                        <Stack gap={2} style={{ flexGrow: 1 }}>
                          <Text size="sm" fw={500} component="div">
                            Site: {site.name} (id: {site.siteId})
                            {subscriptionType !== undefined &&
                              subscriptionType !== null && (
                                <HoverCard
                                  shadow="md"
                                  width={isMobile ? dropdownWidth : 300}
                                  position="bottom-start"
                                  offset={8}
                                  withArrow
                                  styles={
                                    isMobile
                                      ? {
                                          dropdown: {
                                            left: "20px",
                                          },
                                        }
                                      : {}
                                  }
                                >
                                  {/* Clickable / hoverable trigger */}
                                  <HoverCard.Target>
                                    <ActionIcon
                                      variant="subtle"
                                      size="xs"
                                      className={classes["info-icon"]}
                                    >
                                      <IconInfoCircle size={16} />
                                    </ActionIcon>
                                  </HoverCard.Target>

                                  {/* HoverCard content */}
                                  <HoverCard.Dropdown
                                    style={{
                                      maxWidth: "calc(100vw - 2rem)",
                                    }}
                                  >
                                    <Heading level={4} marginBottom="xs">
                                      License Refresh
                                    </Heading>
                                    <Text size="sm" mb="sm">
                                      Send a{" "}
                                      <Text component="span" fw={700}>
                                        GET
                                      </Text>{" "}
                                      request to the URL below, including
                                      the&nbsp;
                                      <Code mx="xs">X-Site-Key</Code> header.
                                    </Text>
                                    <Text size="sm" mb="sm">
                                      The server returns a JSON object; the
                                      value of its <Code>jws</Code> property is
                                      the license content.
                                    </Text>
                                    <Text size="sm" mb="sm">
                                      Save that value as <Code>lic.jws</Code> in
                                      your site’s&nbsp;
                                      <Code>
                                        /wp-content/uploads/hub-for-wpsuiteio/
                                      </Code>{" "}
                                      directory.
                                    </Text>
                                    <Text size="sm" mb="sm">
                                      <Text fw={600} component="span">
                                        Note:
                                      </Text>{" "}
                                      the license file is valid for{" "}
                                      <b>one&nbsp;month</b>. On{" "}
                                      <b>static&nbsp;sites</b>, automate a
                                      refresh at least <b>once a week</b>. On{" "}
                                      <b>WordPress</b> sites, the Gatey plugin
                                      refreshes it automatically—no manual
                                      action needed.
                                    </Text>{" "}
                                    <Text size="sm">
                                      <Text fw={600} component="span">
                                        URL:
                                      </Text>{" "}
                                      <Code>
                                        <strong>
                                          <a
                                            href="#"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="dark-link"
                                            style={{
                                              textDecoration: "none",
                                            }}
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              const component = jQuery(
                                                "#gatey-license-url-" +
                                                  site.siteId
                                              );
                                              component.trigger("select");
                                              navigator.clipboard.writeText(
                                                apiUrl +
                                                  "/account/" +
                                                  site.accountId +
                                                  "/site/" +
                                                  site.siteId +
                                                  "/license"
                                              );
                                              notifications.show({
                                                title: "License URL copied",
                                                message:
                                                  "License URL copied successfully.",
                                                color: "green",
                                                icon: <IconInfoCircle />,
                                                className:
                                                  classes["notification"],
                                              });
                                              return false;
                                            }}
                                          >
                                            <span
                                              id={
                                                "gatey-license-url-" +
                                                site.siteId
                                              }
                                            >
                                              copy
                                            </span>
                                          </a>
                                        </strong>
                                      </Code>
                                      <br />
                                      <Text fw={600} component="span">
                                        X-Site-Key:
                                      </Text>{" "}
                                      <Code>
                                        <strong>
                                          <a
                                            href="#"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="dark-link"
                                            style={{
                                              textDecoration: "none",
                                            }}
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              const component = jQuery(
                                                "#gatey-site-key-" + site.siteId
                                              );
                                              component.trigger("select");
                                              navigator.clipboard.writeText(
                                                site.siteKey ?? ""
                                              );
                                              notifications.show({
                                                title: "Site key copied",
                                                message:
                                                  "Site key copied successfully.",
                                                color: "green",
                                                icon: <IconInfoCircle />,
                                                className:
                                                  classes["notification"],
                                              });
                                              return false;
                                            }}
                                          >
                                            <span
                                              id={
                                                "gatey-site-key-" + site.siteId
                                              }
                                            >
                                              copy
                                            </span>
                                          </a>
                                        </strong>
                                      </Code>
                                    </Text>
                                  </HoverCard.Dropdown>
                                </HoverCard>
                              )}
                          </Text>
                          {site.account && (
                            <>
                              <Text size="xs" c="dimmed" component="div">
                                Workspace: {site.account.name} (id:{" "}
                                {site.account.accountId}, owner:{" "}
                                <a
                                  className="dark-link"
                                  href={`mailto:${site.account.ownerEmail}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {site.account.ownerEmail}
                                </a>
                                )
                              </Text>
                            </>
                          )}
                        </Stack>
                      </>
                    )}
                  </Flex>
                </Skeleton>
              )}
            </Flex>
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 2 }}>
            Subscription{" "}
            {isMobile && (
              <>
                <Skeleton
                  display="inline-grid"
                  w="fit-content"
                  visible={subscriptionType === undefined}
                >
                  {subscriptionType === null && (
                    <Badge color="grey" miw={45}>
                      FREE
                    </Badge>
                  )}
                  {subscriptionType === "PROFESSIONAL" && (
                    <Badge color="red" miw={35}>
                      PRO
                    </Badge>
                  )}
                </Skeleton>
                {renderSettingsPanel()}
              </>
            )}
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 10 }}>
            <Flex
              direction={{ base: "column", sm: "row" }}
              gap="sm"
              align="center"
            >
              {" "}
              {!isMobile && (
                <Skeleton
                  display="inline-grid"
                  w="fit-content"
                  visible={subscriptionType === undefined}
                >
                  {subscriptionType === null && (
                    <Badge color="grey" miw={45}>
                      FREE
                    </Badge>
                  )}
                  {subscriptionType === "PROFESSIONAL" && (
                    <Badge color="red" miw={35}>
                      PRO
                    </Badge>
                  )}
                </Skeleton>
              )}
              {!!subscriptionType && (
                <Group gap="xs" style={{ justifyContent: "space-between" }}>
                  <Skeleton
                    w="100%"
                    visible={
                      subscriptionType === undefined ||
                      (subscriptionType !== null &&
                        !subscription &&
                        isSitePending)
                    }
                  >
                    <Flex
                      bg="gray.0"
                      p="sm"
                      align="center"
                      style={{ borderRadius: 6, flexGrow: 1 }}
                    >
                      {subscriptionType !== null && (
                        <Stack gap={2}>
                          <Text size="sm" fw={500} component="div">
                            {subscription
                              ? subscription?.active
                                ? "Subscription active"
                                : "Subscription inactive"
                              : "Subscription inaccessible"}
                            {subscription &&
                              subscription.active &&
                              subscription.cancelAtPeriodEnd && (
                                <>
                                  {" "}
                                  — expires on{" "}
                                  <strong>
                                    {new Date(
                                      subscription.currentPeriodEnd * 1000
                                    ).toLocaleDateString()}
                                  </strong>
                                </>
                              )}
                            {subscription &&
                              subscription.active &&
                              !subscription.cancelAtPeriodEnd && (
                                <>
                                  {" "}
                                  — renews automatically{" "}
                                  {subscription.nextSubscriptionType &&
                                    subscriptionType !==
                                      subscription.nextSubscriptionType && (
                                      <>
                                        as a{" "}
                                        <strong>
                                          {subscription.nextSubscriptionType}
                                        </strong>{" "}
                                        subscription{" "}
                                      </>
                                    )}
                                  on{" "}
                                  <strong>
                                    {new Date(
                                      subscription.currentPeriodEnd * 1000
                                    ).toLocaleDateString()}
                                  </strong>
                                </>
                              )}
                          </Text>
                        </Stack>
                      )}
                    </Flex>
                  </Skeleton>
                </Group>
              )}
              {!isMobile && renderSettingsPanel()}
            </Flex>
          </Grid.Col>
        </Grid>
      </Card>
    </Group>
  );
};

function SiteSelectorSkeleton() {
  return (
    <>
      <Skeleton w={{ base: "100%", xs: 350 }} height={80} mb="md" />
      <Skeleton w={{ base: "100%", xs: 350 }} height={80} mb="md" />
      <Skeleton w={{ base: "100%", xs: 350 }} height={80} mb="md" />
    </>
  );
}

const CreateSiteSchema = z.object({
  siteId: z.string().optional(),
  name: z.string(),
  domain: z.string(),
  subscriptionType: z.string().optional(),
});

type CreateSiteInput = z.infer<typeof CreateSiteSchema>;

interface SiteSelectorProps {
  authStatus: "authenticated" | "unauthenticated" | "configuring";
  accountId?: string;
  siteId?: string;
  siteKey?: string;
  subscriber?: boolean;
  onClose: () => void;
  onConnect: (siteSettings: SiteSettings) => Promise<void>;
}

function SiteSelector({
  authStatus,
  accountId,
  siteId,
  siteKey,
  subscriber,
  onClose,
  onConnect,
}: SiteSelectorProps) {
  const [sitesReloading, setSitesReloading] = useState(false);
  const [siteConnecting, setSiteConnecting] = useState(false);
  const [activePage, setActivePage] = useState(1);

  const [siteEditing, setSiteEditing] = useState<boolean>(false);
  const [selectedAccountId, setSelectedAccountId] = useState<
    string | undefined
  >(accountId);
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(
    siteId
  );
  const [selectedSiteKey, setSelectedSiteKey] = useState<string | undefined>(
    siteKey
  );
  const [selectedSiteSubscriber, setSelectedSiteSubscriber] = useState<
    boolean | undefined
  >(subscriber);

  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<"name" | "domain">("name"); // ÚJ

  const [debouncedFilter] = useDebouncedValue(filter, 200);

  const form = useForm<CreateSiteInput>({
    mode: "uncontrolled",
    initialValues: {
      subscriptionType: "",
      siteId: "",
      name: "",
      domain: "",
    },
    validate: zod4Resolver(CreateSiteSchema as never),
  });

  const fetchAccounts = useCallback(
    () =>
      get({
        apiName: "backendWithIam",
        path: "/account",
      })
        .response.then((res) => res.body.json())
        .then((result) => {
          const data = result as unknown as Account[];
          if (!selectedAccountId) {
            setSelectedAccountId(data[0].accountId);
          }
          return data;
        })
        .catch((err) => {
          console.error("Error fetching workspaces:", err);
          throw err;
        })
        .finally(() => {
          setSitesReloading(false);
        }),
    [selectedAccountId]
  );

  const fetchSites = useCallback(
    ({ pageParam = null }: { pageParam: string | null }) =>
      get({
        apiName: "backend",
        path: `/account/${selectedAccountId}/site`,
        options: pageParam
          ? {
              queryParams: {
                limit: String(PAGE_SIZE),
                last_key: pageParam,
                order,
                ...(debouncedFilter ? { search: debouncedFilter } : {}),
              },
            }
          : {
              queryParams: {
                limit: String(PAGE_SIZE),
                order,
                ...(debouncedFilter ? { search: debouncedFilter } : {}),
              },
            },
      })
        .response.then((res) => res.body.json())
        .then((result) => result as unknown as ListPage<Site>)
        .catch((err) => {
          console.error("Error fetching sites:", err);
          throw err;
        })
        .finally(() => {
          setSitesReloading(false);
        }),
    [selectedAccountId, debouncedFilter, order]
  );

  const {
    data: accountsRecord,
    isPending: accountsPending,
    error: accountsError,
  } = useQuery({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
    enabled: authStatus === "authenticated",
  });

  const {
    data: sitesRecord,
    isPending: sitesPending,
    error: sitesError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["sites", selectedAccountId, debouncedFilter, order],
    queryFn: fetchSites,
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.lastKey ?? undefined,
    select: (data) => ({
      pages: data.pages.filter((p) => p.list.length > 0),
    }),

    enabled: !!selectedAccountId && authStatus === "authenticated",
  });

  const sites = useMemo(
    () => sitesRecord?.pages.flatMap((p) => (p as ListPage<Site>).list) ?? [],
    [sitesRecord]
  );

  const totalPages = useMemo(
    () => Math.max(sitesRecord?.pages.length ?? 0, 1),
    [sitesRecord]
  );

  if (totalPages > 0 && activePage > totalPages) {
    console.log("Adjusting active page from", activePage, "to", totalPages);
    setActivePage(totalPages);
  }

  const handleNextPage = useCallback(
    (page: number) => {
      if (page > totalPages && hasNextPage) {
        fetchNextPage().then((data) => {
          setActivePage(Math.min(page, data?.data?.pages.length ?? 0));
        });
      } else {
        setActivePage(page);
      }
    },
    [fetchNextPage, hasNextPage, totalPages]
  );

  const queryClient = useQueryClient();

  const updateSiteMutation = useMutation({
    mutationFn: async (siteDetails: {
      siteId?: string;
      name: string;
      domain: string;
    }) => {
      const siteUpdateDetails: {
        name: string;
        domain: string;
      } = {
        name: siteDetails.name,
        domain: siteDetails.domain,
      };
      const result = await (siteDetails.siteId &&
      siteDetails.siteId.trim() !== ""
        ? API.put({
            apiName: "backend",
            path: `/account/${selectedAccountId}/site/${siteDetails.siteId}`,
            options: {
              body: siteUpdateDetails,
            },
          })
        : API.post({
            apiName: "backend",
            path: `/account/${selectedAccountId}/site`,
            options: {
              body: siteUpdateDetails,
            },
          })
      ).response
        .then((response) => response.body.json())
        .then((result) => {
          notifications.show({
            title: __("Site updated", TEXT_DOMAIN),
            message: __("Site updated successfully.", TEXT_DOMAIN),
            color: "green",
            icon: <IconInfoCircle />,
            className: classes["notification"],
          });
          return result as unknown as Site;
        })
        .catch((err) => {
          console.error("Error:", (err as Error).message);
          notifications.show({
            title: __("Error occured", TEXT_DOMAIN),
            message: (err as Error).message,
            color: "red",
            icon: <IconAlertCircle />,
            className: classes["notification"],
          });
        });

      return result as unknown as Site;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites", selectedAccountId] });
      setSiteEditing(false);
    },
    onError: (error) => {
      notifications.show({
        title: __("Error occured", TEXT_DOMAIN),
        message: (error as Error).message,
        color: "red",
        icon: <IconAlertCircle />,
        className: classes["notification"],
      });
    },
  });

  const deleteSiteMutation = useMutation({
    mutationFn: async (siteId: string) => {
      await API.del({
        apiName: "backend",
        path: `/account/${selectedAccountId}/site/${siteId}`,
      }).response;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["sites"] });
      const prev = queryClient.getQueryData(["sites"]);
      queryClient.setQueryData(
        ["sites"],
        (
          data:
            | {
                pages: ListPage<Site>[];
              }
            | undefined
        ) => {
          if (!data) return data;
          return {
            ...data,
            pages: data.pages.map((p: ListPage<Site>) => ({
              ...p,
              list: p.list.filter((s: Site) => s.siteId !== id),
            })),
          };
        }
      );
      return { prev };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites", selectedAccountId] });
      if (selectedSiteId === siteId) {
        setSelectedAccountId(undefined);
        setSelectedSiteId(undefined);
        setSelectedSiteKey(undefined);
        setSelectedSiteSubscriber(undefined);
      }
    },
  });

  const currentPage = useMemo(() => {
    const start = (activePage - 1) * PAGE_SIZE;
    return sites?.slice(start, start + PAGE_SIZE);
  }, [sites, activePage]);

  if (accountsPending) {
    return <SiteSelectorSkeleton />;
  }

  return (
    <>
      {accountsError ? (
        <Text c="red">Error: {accountsError?.message}</Text>
      ) : (
        <>
          {(accountsRecord?.length > 1 ||
            !accountsRecord.find((a) => a.accountId === selectedAccountId)) && (
            <Select
              label="Select a workspace"
              description="Select a workspace to manage sites"
              w={{ base: "100%", xs: 350 }}
              height={80}
              mb="md"
              value={selectedAccountId}
              onChange={(value) => {
                if (value) {
                  setSelectedAccountId(value);
                  setSelectedSiteId(value === accountId ? siteId : undefined);
                  setSelectedSiteKey(value === accountId ? siteKey : undefined);
                  setSelectedSiteSubscriber(
                    value === accountId ? subscriber : undefined
                  );
                  setActivePage(1);
                  setSiteEditing(false);
                }
              }}
              data={accountsRecord.map((account) => ({
                value: account.accountId,
                label: account.name,
              }))}
              classNames={{
                dropdown: classes["dropdown"],
              }}
            />
          )}
          <Radio.Group
            label="Select a site"
            description="Select a site to connect this WordPress instance to"
            mb="md"
            defaultValue={siteId + "|" + siteKey + "|" + subscriber}
            value={
              selectedSiteId +
              "|" +
              selectedSiteKey +
              "|" +
              selectedSiteSubscriber
            }
            onChange={(value) => {
              const values = value.split("|");
              setSelectedSiteId(values[0]);
              if (values.length > 1) {
                setSelectedSiteKey(values[1]);
              }
              if (values.length > 2) {
                setSelectedSiteSubscriber(values[2] === "true");
              }
            }}
          >
            <Group gap="xs" mt="xs">
              <SegmentedControl
                size="xs"
                data={[
                  { label: "Name", value: "name" },
                  { label: "Domain", value: "domain" },
                ]}
                value={order}
                onChange={(val) => setOrder(val as "name" | "domain")}
              />
              <TextInput
                placeholder="Filter…"
                size="xs"
                value={filter}
                onChange={(e) => {
                  setFilter(e.currentTarget.value);
                  setActivePage(1);
                }}
              />
            </Group>
            <Skeleton
              visible={
                isFetchingNextPage ||
                (!!selectedAccountId &&
                  authStatus === "authenticated" &&
                  (sitesPending || sitesReloading))
              }
              mt="md"
              mb="md"
            >
              <Stack pt="md" mb="md" gap="xs">
                <Group
                  gap="xs"
                  style={{ alignContent: "flex-start", overflowY: "auto" }}
                >
                  {(!currentPage?.length || currentPage.length === 0) &&
                    !siteEditing && (
                      <Stack
                        align="center"
                        gap="md"
                        py="xl"
                        mb="lg"
                        w={{ base: "100%", xs: 350 }}
                      >
                        <Title order={4}>No Sites Found</Title>
                        <Text c="dimmed" size="sm" ta="center">
                          You haven't added any sites yet.
                        </Text>
                        <Button
                          variant="gradient"
                          size="xs"
                          leftSection={<IconPlus size={16} />}
                          onClick={() => {
                            form.setValues({
                              subscriptionType: "",
                              siteId: "",
                              name: "",
                              domain: "",
                            });
                            setSiteEditing(true);
                          }}
                        >
                          Add a new site
                        </Button>
                      </Stack>
                    )}
                  {!siteEditing &&
                    currentPage?.map((site) => (
                      <Radio.Card
                        className={classes.radioCard}
                        component="div"
                        p="md"
                        radius="md"
                        value={
                          site.siteId +
                          "|" +
                          site.siteKey +
                          "|" +
                          (site.subscription !== undefined)
                        }
                        key={site.siteId}
                        disabled={siteEditing}
                      >
                        <Group wrap="nowrap" align="flex-start">
                          <Radio.Indicator />
                          <Stack gap="xs" style={{ flexGrow: 1 }}>
                            <Text
                              component="div"
                              fw={700}
                              lh={1.3}
                              size="md"
                              c="bright"
                            >
                              {site.name}
                              {site.domain ===
                                location.hostname.split(":")[0] && (
                                <Badge size="xs" ml="xs" variant="light">
                                  Current domain
                                </Badge>
                              )}
                            </Text>
                            <Text c="dimmed" size="xs">
                              {site.domain}{" "}
                            </Text>
                          </Stack>
                          <Tooltip label="Edit site">
                            <ActionIcon
                              variant="subtle"
                              size="xs"
                              aria-label="Edit site"
                              onClick={(e) => {
                                e.stopPropagation();
                                form.setValues({
                                  subscriptionType: site.subscriptionType,
                                  siteId: site.siteId,
                                  name: site.name,
                                  domain: site.domain,
                                });
                                setSiteEditing(true);
                              }}
                            >
                              <IconEdit size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip
                            label={
                              site.subscriptionType !== undefined
                                ? "Cannot delete site with active subscription"
                                : "Delete site"
                            }
                          >
                            <ActionIcon
                              variant="subtle"
                              size="xs"
                              color="red"
                              aria-label={
                                site.subscriptionType !== undefined
                                  ? "Cannot delete site with active subscription"
                                  : "Delete site"
                              }
                              disabled={site.subscriptionType !== undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                modals.openConfirmModal({
                                  children: (
                                    <>
                                      <Heading
                                        level={3}
                                        marginBottom="var(--mantine-spacing-md)"
                                      >
                                        Delete {site.name}?
                                      </Heading>{" "}
                                      <Text mb="sm">
                                        This site does not have an active
                                        subscription, but it may still contain
                                        saved configuration settings from
                                        another WordPress instance.
                                      </Text>
                                      <Text mb="sm">
                                        Deleting this site will permanently
                                        remove all saved settings, and this
                                        action cannot be undone.
                                      </Text>
                                      <Text fw={500}>
                                        Are you sure you want to delete this
                                        site?
                                      </Text>
                                    </>
                                  ),
                                  labels: {
                                    confirm: "Yes, Delete",
                                    cancel: "No",
                                  },
                                  confirmProps: {
                                    className: classes["console-button"],
                                  },
                                  cancelProps: {
                                    variant: "outline",
                                    className:
                                      classes["console-button-outline"],
                                  },
                                  withCloseButton: false,
                                  onConfirm: () =>
                                    deleteSiteMutation.mutate(site.siteId),
                                  zIndex: 100002,
                                  xOffset: "1dvh",
                                  yOffset: "1dvh",
                                  centered: true,
                                });
                              }}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Radio.Card>
                    ))}
                </Group>
                {!siteEditing && (
                  <Pagination
                    classNames={{
                      root: classes["pagination"],
                      control: classes["pagination-control"],
                    }}
                    total={
                      hasNextPage
                        ? Math.max(totalPages, activePage + 1)
                        : totalPages
                    }
                    value={activePage}
                    onChange={handleNextPage}
                    mt="md"
                  />
                )}
                {siteEditing && (
                  <Card
                    component="form"
                    withBorder
                    w={{ base: "100%", xs: 350 }}
                    onSubmit={form.onSubmit((values) => {
                      updateSiteMutation.mutate({
                        siteId: values.siteId,
                        name: values.name,
                        domain: values.domain,
                      });
                    })}
                  >
                    <LoadingOverlay
                      visible={updateSiteMutation.isPending}
                      zIndex={1000}
                      overlayProps={{ radius: "md", blur: 2 }}
                    />
                    <VisuallyHidden>
                      <TextInput
                        key={form.key("siteId")}
                        {...form.getInputProps("siteId")}
                      />
                    </VisuallyHidden>
                    <TextInput
                      label="Site name"
                      placeholder="My WordPress site"
                      key={form.key("name")}
                      required
                      {...form.getInputProps("name")}
                    />
                    <TextInput
                      label="Licensed Domain"
                      placeholder="my-wordpress-site.com"
                      key={form.key("domain")}
                      required
                      {...form.getInputProps("domain")}
                    />
                    {/*!!form.getValues().subscriptionType && (
                      <Text c="dimmed" size="xs" mt="xs" fs="italic">
                        You cannot change the secondary domain of a site with an
                        active subscription.
                      </Text>
                    )*/}
                    <Group justify="space-between" mt="md">
                      <Button
                        variant="outline"
                        size="xs"
                        leftSection={<IconX size={16} />}
                        onClick={() => setSiteEditing(false)}
                      >
                        Cancel
                      </Button>
                      <Flex gap={0}>
                        <Button
                          type="submit"
                          variant="gradient"
                          size="xs"
                          leftSection={<IconCheck size={16} />}
                        >
                          Save
                        </Button>
                      </Flex>
                    </Group>
                  </Card>
                )}
                {currentPage && (
                  <Group justify="center">
                    <Button
                      variant="subtle"
                      size="xs"
                      leftSection={<IconPlus size={16} />}
                      onClick={() => {
                        form.setValues({
                          subscriptionType: "",
                          siteId: "",
                          name: "",
                          domain: "",
                        });
                        setSiteEditing(true);
                      }}
                      disabled={siteEditing}
                    >
                      Add a new site
                    </Button>
                  </Group>
                )}
              </Stack>
            </Skeleton>
          </Radio.Group>
        </>
      )}

      <Group justify="space-between">
        <Button
          variant="outline"
          onClick={onClose}
          leftSection={<IconLogout size={16} />}
        >
          Close
        </Button>
        <Button
          variant="gradient"
          onClick={() => {
            setSiteConnecting(true);
            onConnect({
              accountId: selectedAccountId,
              siteId: selectedSiteId,
              siteKey: selectedSiteKey,
              subscriber: selectedSiteSubscriber,
            }).then(() => {
              setSiteConnecting(false);
            });
          }}
          leftSection={<IconLink size={16} />}
          disabled={!!sitesError || siteEditing}
          loading={siteConnecting}
        >
          Connect
        </Button>
      </Group>
    </>
  );
}

async function fetchAccount(accountId: string) {
  const response = await get({
    apiName: "backend",
    path: `/account/${accountId}`,
  }).response;
  const body = await response.body.json();
  return body as unknown as Account;
}

async function fetchSite(accountId: string, siteId: string, siteKey?: string) {
  const options = {
    apiName: "backend",
    path: `/account/${accountId}/site/${siteId}${siteKey ? "/settings" : ""}`,
    options: {
      headers: {},
    },
  };
  if (siteKey) {
    (options.options.headers as Record<string, string>)["X-Site-Key"] = siteKey;
  }
  const response = await get(options).response;
  const body = await response.body.json();

  return body as unknown as Site;
}
