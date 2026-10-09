import { Alert, Loader, Group, Text } from "@mantine/core";
import { __ } from "@wordpress/i18n";
import { TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";
import { useEffect, useRef, useState } from "react";
import { useSurfaceHelp } from "./capability-help-context";

type Mount = (element: HTMLElement, context: { openHelp: (id: string) => void }) => () => void;

/** Optional plugin-owned product controls. Old hubs simply retain their existing surface. */
export default function PluginSurface({ id }: { id: string }) {
  const node = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const { open } = useSurfaceHelp();
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let mounted = false;
    const mount = () => {
      const registry = (window as Window & { smartcloudWpSuiteSurfaces?: Record<string, Mount> }).smartcloudWpSuiteSurfaces;
      if (mounted || !node.current || typeof registry?.[id] !== "function") return;
      try { cleanup = registry[id](node.current, { openHelp: open }); mounted = true; setState("ready"); }
      catch { setState("failed"); }
    };
    window.addEventListener("smartcloud-wpsuite-surface-ready", mount);
    mount();
    const timer = window.setTimeout(() => { if (!mounted) setState("failed"); }, 10000);
    return () => { window.clearTimeout(timer); window.removeEventListener("smartcloud-wpsuite-surface-ready", mount); cleanup?.(); };
  }, [id, open]);
  return <>
    {state === "loading" && <Group role="status"><Loader size="sm" /><Text size="sm">{__("Loading tools…", TEXT_DOMAIN)}</Text></Group>}
    {state === "failed" && <Alert color="yellow">{__("Additional tools could not load. Refresh this page or open Advanced settings.", TEXT_DOMAIN)}</Alert>}
    <div ref={node} data-wpsuite-surface={id} />
  </>;
}
