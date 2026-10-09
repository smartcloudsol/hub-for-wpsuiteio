import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Button, Drawer, Group, Stack, Text, Title, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { __, sprintf } from "@wordpress/i18n";
import { TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";
import type { SurfaceHelpTopic } from "./navigation";
import "./doc-sidebar.css";
import { HelpContext, useSurfaceHelp } from "./capability-help-context";

/** Accessible counterpart of the detailed admins' InfoLabel + DocSidebar pattern. */
export function InfoLabel({ text, helpId }: { text: string; helpId?: string }) {
  const { topics, open } = useSurfaceHelp();
  const topic = topics.find(item => item.id === helpId);
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%" }}>
    <span>{text}</span>
    {topic && <Tooltip label={topic.summary} multiline w={280} withArrow>
      <ActionIcon component="button" type="button" variant="subtle" size="sm" aria-label={sprintf(__("Help: %s", TEXT_DOMAIN), text)} onClick={event => { event.preventDefault(); event.stopPropagation(); open(topic.id); }}>
        <IconInfoCircle size={16} aria-hidden="true" />
      </ActionIcon>
    </Tooltip>}
  </span>;
}

function standardTopics(): SurfaceHelpTopic[] {
  return [
    { id: "status", title: __("Status", TEXT_DOMAIN), summary: __("Saved settings and working services are different states.", TEXT_DOMAIN), paragraphs: [__("Configured means the required settings are present. It does not by itself verify a remote service, publish content or place a block on your site. Check the service and placement details shown for this tool.", TEXT_DOMAIN)] },
    { id: "setup", title: __("Setup and settings", TEXT_DOMAIN), summary: __("Review the current settings or reopen the guided setup.", TEXT_DOMAIN), paragraphs: [__("The setup walks through a few related fields at a time. Review your choices before saving. Only the displayed settings change; other detailed settings are preserved. Cancel leaves the saved configuration unchanged.", TEXT_DOMAIN)] },
    { id: "placement", title: __("Use on this site", TEXT_DOMAIN), summary: __("Choose where visitors or editors will use the tool.", TEXT_DOMAIN), paragraphs: [__("Follow the named block or editor instructions. Opening a page editor does not insert or publish anything automatically. Review and save content in WordPress. Where placement is detected, the page states what was inspected.", TEXT_DOMAIN)] },
    { id: "pro", title: __("Pro information", TEXT_DOMAIN), summary: __("Read-only information from the connected WP Suite site.", TEXT_DOMAIN), paragraphs: [__("These details describe the connected configuration. Opening this section does not change it or confirm that a backend is responding. Open detailed settings for the complete configuration.", TEXT_DOMAIN)] },
    { id: "advanced", title: __("Advanced settings and resources", TEXT_DOMAIN), summary: __("Open the full plugin controls for less common settings.", TEXT_DOMAIN), paragraphs: [__("Detailed settings contain the full plugin controls, diagnostics and resources available to your WordPress account. Setup and detailed settings use the same plugin configuration.", TEXT_DOMAIN)] },
  ];
}

export function CapabilityHelp({ topics = [], children }: { topics?: SurfaceHelpTopic[]; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  const [active, setActive] = useState("status");
  const [entered, setEntered] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const allTopics = useMemo(() => [...standardTopics().filter(item => !topics.some(topic => topic.id === item.id)), ...topics], [topics]);
  const open = useCallback((id: string) => { setActive(id); setOpened(true); }, []);
  const focusTopic = useCallback(() => {
    const target = content.current?.querySelector<HTMLElement>(`[data-help-topic="${active}"]`);
    target?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target?.focus({ preventScroll: true });
  }, [active]);
  useEffect(() => { if (opened && entered) { const timer = window.setTimeout(focusTopic, 0); return () => window.clearTimeout(timer); } }, [opened, entered, focusTopic]);
  return <HelpContext.Provider value={{ topics: allTopics, open }}>
    <div>
    <Group justify="flex-end" mb="xs"><Button variant="subtle" size="compact-xs" leftSection={<IconInfoCircle size={16} />} onClick={() => open(allTopics[0].id)}>{__("Help", TEXT_DOMAIN)}</Button></Group>
    {children}
    </div>
    <Drawer opened={opened} onClose={() => { setOpened(false); setEntered(false); }} position="right" size="md" title={__("Tool help", TEXT_DOMAIN)} zIndex={100100} classNames={{ content: "wpsuite-doc-sidebar" }} onEnterTransitionEnd={() => setEntered(true)}>
      <Stack ref={content} gap="lg">
        <Group gap="xs" aria-label={__("Help topics", TEXT_DOMAIN)}>{allTopics.map(topic => <Button key={topic.id} size="compact-xs" variant={active === topic.id ? "light" : "subtle"} onClick={() => setActive(topic.id)}>{topic.title}</Button>)}</Group>
        {allTopics.map(topic => <section key={topic.id}>
          <Title order={3} size="h4" data-help-topic={topic.id} className={active === topic.id ? "wpsuite-help-active" : undefined} tabIndex={-1} style={{ scrollMarginTop: 12 }}>{topic.title}</Title>
          <Text size="sm" fw={500} mt="xs">{topic.summary}</Text>
          {topic.paragraphs.map((paragraph, index) => <Text key={index} size="sm" mt="sm">{paragraph}</Text>)}
        </section>)}
      </Stack>
    </Drawer>
  </HelpContext.Provider>;
}
