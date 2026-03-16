import { useEffect, useRef } from "react";
import { Drawer, Stack, Text, Title, List, Code } from "@mantine/core";

import classes from "./main.module.css";

interface DocSidebarProps {
  opened: boolean;
  close: () => void;
  scrollToId: string;
}

export function DocSidebar({ opened, close, scrollToId }: DocSidebarProps) {
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollHighlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any pending scroll/highlight operations from previous renders/opens
    if (scrollHighlightTimeoutRef.current) {
      clearTimeout(scrollHighlightTimeoutRef.current);
      scrollHighlightTimeoutRef.current = null;
    }
    // Clear any lingering highlight timeouts
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
    // Always remove existing highlights immediately when the effect re-runs or drawer closes
    document
      .querySelectorAll(`.${classes["highlighted-doc-item"]}`)
      .forEach((el) => el.classList.remove(classes["highlighted-doc-item"]));

    // Only proceed if the drawer is currently open and has an ID to scroll to
    if (!opened || !scrollToId) {
      return;
    }

    // Schedule the DOM manipulation to run after the current render cycle
    scrollHighlightTimeoutRef.current = setTimeout(() => {
      const targetElement = document.getElementById(scrollToId);

      if (!targetElement) {
        scrollHighlightTimeoutRef.current = null;
        return;
      }

      // Scroll to the element
      targetElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      // Highlight the element
      targetElement.classList.add(classes["highlighted-doc-item"]);

      // Remove the highlight after a short duration
      highlightTimeoutRef.current = setTimeout(() => {
        targetElement.classList.remove(classes["highlighted-doc-item"]);
        highlightTimeoutRef.current = null;
      }, 2000); // Highlight for 2 seconds

      scrollHighlightTimeoutRef.current = null; // Clear the ref once done
    }, 0); // Delay of 0ms pushes execution after the current event loop cycle

    // Cleanup function for the useEffect
    return () => {
      // Clear the main scroll/highlight timeout if the component unmounts or dependencies change
      if (scrollHighlightTimeoutRef.current) {
        clearTimeout(scrollHighlightTimeoutRef.current);
        scrollHighlightTimeoutRef.current = null;
      }
      // Clear the highlight removal timeout if the component unmounts or dependencies change
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = null;
      }
      // Ensure highlights are removed on cleanup as well
      document
        .querySelectorAll(`.${classes["highlighted-doc-item"]}`)
        .forEach((el) => el.classList.remove(classes["highlighted-doc-item"]));
    };
  }, [opened, scrollToId]);

  return (
    <Drawer
      opened={opened}
      onClose={close}
      position="right"
      title="Documentation"
      zIndex={999999}
    >
      <Stack gap="md">
        <Title order={2}>WPSuite General Settings</Title>
        <Text>
          These settings apply site-wide to all WPSuite.io plugins. Configure
          them once here instead of in each individual plugin.
        </Text>

        {/* ── reCAPTCHA Site Key ──────────────────────────────────── */}
        <Title order={3} mt="md" id="recaptcha-site-key">
          Google reCAPTCHA (v3) Site Key
        </Title>
        <Text>
          Google reCAPTCHA protects your site from automated abuse without
          annoying your real visitors. Gatey and other WPSuite plugins can work
          with both the standard and Enterprise APIs.
        </Text>
        <Text>
          Simply paste your Site Key here. This key is required for components
          that use <Code>grecaptcha.execute()</Code> (mandatory for Enterprise).
          The matching Secret Key is only required server-side when you verify
          tokens in a custom API (for example, in a pre-sign-up Lambda
          function).
        </Text>
        <List size="sm" spacing="sm" mt="xs">
          <List.Item>
            <strong>Standard reCAPTCHA v3:</strong> Create your site key at{" "}
            <a
              href="https://www.google.com/recaptcha/admin"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://www.google.com/recaptcha/admin
            </a>
            . Select "reCAPTCHA v3" and add your domain.
          </List.Item>
          <List.Item>
            <strong>reCAPTCHA Enterprise:</strong> Set up your key at{" "}
            <a
              href="https://cloud.google.com/recaptcha-enterprise/docs/create-key"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Cloud Console
            </a>
            , then check the "Use reCAPTCHA Enterprise" box below.
          </List.Item>
        </List>

        {/* ── Use reCAPTCHA Enterprise ────────────────────────────── */}
        <Title order={3} mt="md" id="use-recaptcha-enterprise">
          Use reCAPTCHA Enterprise
        </Title>
        <Text>
          Enable this if you're using{" "}
          <strong>Google reCAPTCHA Enterprise</strong> instead of the standard
          version. Components need this setting even if provider rendering is
          disabled.
        </Text>
        <Text>
          reCAPTCHA Enterprise provides additional features like fraud
          prevention, advanced analytics, and SLA-backed support. It requires a
          Google Cloud project and may incur costs based on usage.
        </Text>
        <Text>
          When enabled and provider rendering is active, WPSuite will load the
          Enterprise API endpoint (
          <Code>www.google.com/recaptcha/enterprise.js</Code> or{" "}
          <Code>recaptcha.net/recaptcha/enterprise.js</Code> if you also enable
          "Use recaptcha.net").
        </Text>

        {/* ── Render reCAPTCHA Provider ───────────────────────────── */}
        <Title order={3} mt="md" id="render-recaptcha-provider">
          Render reCAPTCHA Provider
        </Title>
        <Text>
          When enabled (default), WPSuite plugins will automatically inject the
          Google reCAPTCHA script into your pages where needed. This is the
          recommended setting for most sites.
        </Text>
        <Text>
          <strong>When to disable:</strong> If you already have a site-wide
          reCAPTCHA script loaded (for example, through a theme or another
          plugin), disable this option to prevent loading the script twice.
        </Text>
        <Text>
          Note: When disabled, the <Code>Use recaptcha.net</Code> setting below
          will also be disabled, since it only applies to the WPSuite provider.
          However, <Code>Use reCAPTCHA Enterprise</Code> remains enabled because
          components need this information even when the provider is not
          rendered.
        </Text>

        {/* ── Use recaptcha.net ────────────────────────────────────── */}
        <Title order={3} mt="md" id="use-recaptcha-net">
          Use recaptcha.net
        </Title>
        <Text>
          By default, reCAPTCHA loads from <Code>www.google.com</Code>. If you
          enable this option, it will load from <Code>recaptcha.net</Code>{" "}
          instead.
        </Text>
        <Text>
          <strong>When to use this:</strong> Some regions or networks block
          Google services. The <Code>recaptcha.net</Code> domain is often
          accessible in these regions and provides the same functionality.
        </Text>
        <Text>
          This setting only applies when "Render reCAPTCHA Provider" is enabled.
          The URLs used will be:
        </Text>
        <List size="sm" mt="xs">
          <List.Item>
            Standard: <Code>recaptcha.net/recaptcha/api.js</Code>
          </List.Item>
          <List.Item>
            Enterprise: <Code>recaptcha.net/recaptcha/enterprise.js</Code>
          </List.Item>
        </List>

        <Text mt="lg" size="sm" c="dimmed" fs="italic">
          For more information about implementing reCAPTCHA in your custom
          authentication flows, see the{" "}
          <a
            href="https://wpsuite.io/docs/gatey"
            target="_blank"
            rel="noopener noreferrer"
          >
            Gatey documentation
          </a>
          .
        </Text>
      </Stack>
    </Drawer>
  );
}
