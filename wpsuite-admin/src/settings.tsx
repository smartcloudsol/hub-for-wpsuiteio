import { useCallback, useState } from "react";
import {
  DEFAULT_THEME,
  Button,
  Card,
  Group,
  Stack,
  Text,
  TextInput,
  Checkbox,
  ActionIcon,
} from "@mantine/core";
import { useMediaQuery, useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";

import { IconDeviceFloppy, IconHelp } from "@tabler/icons-react";

import { __experimentalHeading as Heading } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

import { getWpSuite, TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";

import { DocSidebar } from "./settings-doc-sidebar";

const wpsuite = getWpSuite();

type RecaptchaSettings = {
  reCaptchaPublicKey: string;
  useRecaptchaNet: boolean;
  useRecaptchaEnterprise: boolean;
  renderRecaptchaProvider: boolean;
};

export default function SettingsScreen() {
  const [settings, setSettings] = useState<RecaptchaSettings>({
    reCaptchaPublicKey: wpsuite?.siteSettings?.reCaptchaPublicKey || "",
    useRecaptchaNet: wpsuite?.siteSettings?.useRecaptchaNet || false,
    useRecaptchaEnterprise:
      wpsuite?.siteSettings?.useRecaptchaEnterprise || false,
    renderRecaptchaProvider:
      wpsuite?.siteSettings?.renderRecaptchaProvider ?? true,
  });
  const [saving, setSaving] = useState<boolean>(false);
  const [opened, { open, close }] = useDisclosure(false);
  const [scrollToId, setScrollToId] = useState<string>("");

  const isMobile = useMediaQuery(
    `(max-width: ${DEFAULT_THEME.breakpoints.sm})`,
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const currentSiteSettings = wpsuite?.siteSettings || {};
      const payload = {
        ...currentSiteSettings,
        ...settings,
      };

      const res = await fetch(`${wpsuite!.restUrl}/update-site-settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WP-Nonce": wpsuite!.nonce,
        },
        body: JSON.stringify(payload),
        credentials: "same-origin",
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      notifications.show({
        title: __("Settings saved", TEXT_DOMAIN),
        message: __("Settings saved successfully.", TEXT_DOMAIN),
        color: "green",
      });
    } catch (e) {
      notifications.show({
        title: __("Error occurred", TEXT_DOMAIN),
        message: (e as Error)?.message || "Unknown error",
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const InfoLabelComponent = useCallback(
    ({ text, scrollToId }: { text: string; scrollToId: string }) => (
      <Group align="center" gap="0.25rem">
        {text}
        <ActionIcon
          variant="subtle"
          onClick={() => {
            setScrollToId(scrollToId);
            open();
          }}
          size="sm"
        >
          <IconHelp size={14} />
        </ActionIcon>
      </Group>
    ),
    [open],
  );

  return (
    <Stack p="md" gap="md" maw={1280}>
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
          isMobile ? "WPSuite Settings" : "WPSuite General Settings",
          TEXT_DOMAIN,
        )}
      </Heading>
      <Text>
        Configure settings that apply to all WPSuite.io plugins on your site,
        such as Google reCAPTCHA integration for forms and authentication.
      </Text>

      <Card withBorder radius="lg" p="lg">
        <Text fw={600} mb="md">
          Google reCAPTCHA Settings
        </Text>
        <Stack gap="md">
          <TextInput
            disabled={saving}
            label={
              <InfoLabelComponent
                text="Google reCAPTCHA (v3) Site Key"
                scrollToId="recaptcha-site-key"
              />
            }
            description="Create the key in your reCAPTCHA project, then paste it here. Required for components that use grecaptcha.execute() (mandatory for Enterprise)."
            value={settings.reCaptchaPublicKey}
            onChange={(e) =>
              setSettings({
                ...settings,
                reCaptchaPublicKey: e.target.value,
              })
            }
          />

          <Checkbox
            disabled={saving}
            label={
              <InfoLabelComponent
                text="Use reCAPTCHA Enterprise"
                scrollToId="use-recaptcha-enterprise"
              />
            }
            description="Enable if you're using Google reCAPTCHA Enterprise instead of the standard version. Components need this setting even if provider rendering is disabled."
            checked={settings.useRecaptchaEnterprise}
            onChange={(e) =>
              setSettings({
                ...settings,
                useRecaptchaEnterprise: e.currentTarget.checked,
              })
            }
          />

          <Checkbox
            disabled={saving}
            label={
              <InfoLabelComponent
                text="Render reCAPTCHA Provider"
                scrollToId="render-recaptcha-provider"
              />
            }
            description="Enable this to automatically load the Google reCAPTCHA script. Disable if you already have a site-wide reCAPTCHA script loaded."
            checked={settings.renderRecaptchaProvider}
            onChange={(e) =>
              setSettings({
                ...settings,
                renderRecaptchaProvider: e.currentTarget.checked,
              })
            }
          />

          <Checkbox
            disabled={saving || !settings.renderRecaptchaProvider}
            label={
              <InfoLabelComponent
                text="Use recaptcha.net"
                scrollToId="use-recaptcha-net"
              />
            }
            description="Enable to load reCAPTCHA from recaptcha.net instead of google.com (useful in regions where Google services are restricted)."
            checked={settings.useRecaptchaNet}
            onChange={(e) =>
              setSettings({
                ...settings,
                useRecaptchaNet: e.currentTarget.checked,
              })
            }
          />
        </Stack>
      </Card>

      <Group justify="flex-end">
        <Button
          leftSection={<IconDeviceFloppy size={16} />}
          onClick={handleSave}
          loading={saving}
        >
          {__("Save Settings", TEXT_DOMAIN)}
        </Button>
      </Group>

      <DocSidebar opened={opened} close={close} scrollToId={scrollToId} />
    </Stack>
  );
}
