import { useCallback, useState } from "react";
import {
  Button,
  Card,
  Group,
  Stack,
  Text,
  TextInput,
  Textarea,
  Checkbox,
  ActionIcon,
  Tabs,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";

import { IconDeviceFloppy, IconHelp } from "@tabler/icons-react";

import { __ } from "@wordpress/i18n";

import { getWpSuite, TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";

import { DocSidebar } from "./settings-doc-sidebar";
import { useAdminSectionHistory } from "./admin-section-history";
import { TranslationCatalogEditor } from "./translation-catalog/translation-catalog-editor";

const wpsuite = getWpSuite();
const themeCssEditorUrl = (
  wpsuite as (typeof wpsuite & { themeCssEditorUrl?: string })
)?.themeCssEditorUrl;


type RecaptchaSettings = {
  reCaptchaPublicKey: string;
  useRecaptchaNet: boolean;
  useRecaptchaEnterprise: boolean;
  renderRecaptchaProvider: boolean;
};

type InfoLabelProps = {
  text: string;
  scrollToId: string;
  onOpen: (scrollToId: string) => void;
};

function InfoLabel({ text, scrollToId, onOpen }: InfoLabelProps) {
  return (
    <Group align="center" gap="0.25rem">
      {text}
      <ActionIcon
        variant="subtle"
        onClick={() => onOpen(scrollToId)}
        size="sm"
        aria-label={`Open documentation for ${text}`}
      >
        <IconHelp size={14} />
      </ActionIcon>
    </Group>
  );
}

type PlatformSection = "recaptcha" | "styling" | "translations";
function sectionFromSearch(search: string): PlatformSection {
  const section = new URLSearchParams(search).get("section");
  return section === "styling" || section === "translations" ? section : "recaptcha";
}

export default function SettingsScreen() {
  const [section, setSection] = useState<PlatformSection>(() => sectionFromSearch(window.location.search));
  const selectSection = useAdminSectionHistory(section, sectionFromSearch, next => { setSection(next); return next; });
  const [settings, setSettings] = useState<RecaptchaSettings>({
    reCaptchaPublicKey: wpsuite?.siteSettings?.reCaptchaPublicKey || "",
    useRecaptchaNet: wpsuite?.siteSettings?.useRecaptchaNet || false,
    useRecaptchaEnterprise:
      wpsuite?.siteSettings?.useRecaptchaEnterprise || false,
    renderRecaptchaProvider:
      wpsuite?.siteSettings?.renderRecaptchaProvider ?? true,
  });
  const [saving, setSaving] = useState<boolean>(false);
  const [themeCssUrls, setThemeCssUrls] = useState<string>(
    ((wpsuite?.siteSettings as { themeCssUrls?: string[] } | undefined)?.themeCssUrls ?? []).join("\n"),
  );
  const [opened, { open, close }] = useDisclosure(false);
  const [scrollToId, setScrollToId] = useState<string>("");

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const currentSiteSettings = wpsuite?.siteSettings || {};
      const payload = {
        ...currentSiteSettings,
        ...settings,
        themeCssUrls: themeCssUrls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean),
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

      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.message || `HTTP ${res.status}`);
      }

      if (wpsuite) {
        wpsuite.siteSettings = payload;
      }

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
  }, [settings, themeCssUrls]);

  const openInfo = useCallback(
    (targetScrollToId: string) => {
      setScrollToId(targetScrollToId);
      open();
    },
    [open],
  );

  return (
    <Stack p="md" gap="md" maw={1280}>
      <Title order={1}>{__("Platform Settings", TEXT_DOMAIN)}</Title>
      <Text c="dimmed">{__("Shared settings for WP Suite tools on this WordPress site.", TEXT_DOMAIN)}</Text>
      <Tabs value={section} onChange={value => selectSection(sectionFromSearch(`section=${value}`))} keepMounted>
        <Tabs.List mb="lg">
          <Tabs.Tab value="recaptcha">{__("reCAPTCHA Settings", TEXT_DOMAIN)}</Tabs.Tab>
          <Tabs.Tab value="styling">{__("Styling", TEXT_DOMAIN)}</Tabs.Tab>
          <Tabs.Tab value="translations">{__("Translations", TEXT_DOMAIN)}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="styling">
      <Card withBorder radius="lg" p="lg">
        <Text fw={600} mb="md">
          WPSuite Theme CSS
        </Text>
        <Stack gap="sm">
          <Text size="sm">
            Edit the shared stylesheet with WordPress&apos;s built-in CSS
            editor and validation. WP Suite components load the published CSS
            inside their own style scopes.
          </Text>
          <Group>
            <Button
              component="a"
              href={themeCssEditorUrl || "#"}
              disabled={!themeCssEditorUrl}
            >
              {__("Open WordPress CSS Editor", TEXT_DOMAIN)}
            </Button>
            <ActionIcon
              variant="subtle"
              onClick={() => openInfo("wpsuite-theme-css")}
              aria-label="Open documentation for WP Suite Theme CSS"
            >
              <IconHelp size={16} />
            </ActionIcon>
          </Group>
          <Textarea
            label={__("Additional stylesheet URLs", TEXT_DOMAIN)}
            description={__("One absolute or site-relative CSS URL per line. Loaded after WP Suite Theme CSS inside each supported frontend component shadow root.", TEXT_DOMAIN)}
            placeholder={"/wp-content/themes/example/assets/components.css\nhttps://cdn.example.com/components.css"}
            minRows={3}
            autosize
            disabled={saving}
            value={themeCssUrls}
            onChange={(event) => setThemeCssUrls(event.currentTarget.value)}
          />
        </Stack>
      </Card>

        </Tabs.Panel>
        <Tabs.Panel value="translations">
          <TranslationCatalogEditor onOpenHelp={() => openInfo("custom-translations")} />
        </Tabs.Panel>
        <Tabs.Panel value="recaptcha">

      <Card withBorder radius="lg" p="lg">
        <Text fw={600} mb="md">
          Google reCAPTCHA Settings
        </Text>
        <Stack gap="md">
          <TextInput
            disabled={saving}
            label={
              <InfoLabel
                text="Google reCAPTCHA (v3) Site Key"
                scrollToId="recaptcha-site-key"
                onOpen={openInfo}
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
              <InfoLabel
                text="Use reCAPTCHA Enterprise"
                scrollToId="use-recaptcha-enterprise"
                onOpen={openInfo}
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
              <InfoLabel
                text="Render reCAPTCHA Provider"
                scrollToId="render-recaptcha-provider"
                onOpen={openInfo}
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
              <InfoLabel
                text="Use recaptcha.net"
                scrollToId="use-recaptcha-net"
                onOpen={openInfo}
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

        </Tabs.Panel>
      </Tabs>
      {section !== "translations" && <Group justify="flex-end">
        <Button
          leftSection={<IconDeviceFloppy size={16} />}
          onClick={handleSave}
          loading={saving}
        >
          {__("Save Settings", TEXT_DOMAIN)}
        </Button>
      </Group>}

      <DocSidebar opened={opened} close={close} scrollToId={scrollToId} />
    </Stack>
  );
}
