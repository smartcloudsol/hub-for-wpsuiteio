import { useEffect, useState, Fragment } from "react";
import {
  DEFAULT_THEME,
  Button,
  Card,
  Group,
  Stack,
  Text,
  Badge,
  Skeleton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import { IconRefresh } from "@tabler/icons-react";

import { __experimentalHeading as Heading } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

import { getWpSuite, TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";

type Versions = {
  current: string;
  required: string;
  ok: boolean;
};

type Check = {
  url?: string;
  ok: boolean | null;
  error?: string | null;
};

type Uploads = {
  basedir: string;
  writable: boolean;
  error?: string | null;
};

type Diagnostics = {
  versions: { wp: Versions; php: Versions };
  rest: Check;
  loopback: Check;
  uploads: Uploads;
  ssl: { enabled: boolean; note: string };
  siteUrl: string;
  timestamp: number;
};

const wpsuite = getWpSuite();

export default function DiagnosticsScreen() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isMobile = useMediaQuery(
    `(max-width: ${DEFAULT_THEME.breakpoints.sm})`
  );

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${wpsuite!.restUrl}/diagnostics`, {
        headers: { "X-WP-Nonce": wpsuite!.nonce },
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Diagnostics;
      setData(json);
    } catch (e) {
      setError((e as Error)?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const Status = ({ ok }: { ok: boolean | null }) =>
    ok === null ? (
      <Badge>n/a</Badge>
    ) : ok ? (
      <Badge color="green">OK</Badge>
    ) : (
      <Badge color="red">Issue</Badge>
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
          isMobile ? "WPSuite.io HUB" : "Central Hub for WPSuite.io Plugins",
          TEXT_DOMAIN
        )}
      </Heading>
      <Group justify="space-between">
        <Text>
          Quick checks to confirm your environment meets the minimum
          requirements for WPSuite.io Plugins. Use the Refresh button to re-run
          the tests; results reflect the current runtime.
        </Text>
        <Button
          leftSection={<IconRefresh size={16} />}
          onClick={load}
          variant="light"
        >
          Refresh
        </Button>
      </Group>
      {loading && (
        <Card withBorder radius="lg" p="lg">
          <Stack>
            <Text>Loading diagnostics...</Text>
            <Skeleton height={12} radius="xl" />
            <Skeleton height={12} radius="xl" />
            <Skeleton height={12} radius="xl" />
            <Skeleton height={12} radius="xl" />
          </Stack>
        </Card>
      )}
      {!loading && error && (
        <Card withBorder radius="lg" p="lg">
          <Text c="red">Failed to load diagnostics: {error}</Text>
        </Card>
      )}
      {!loading && !error && data && (
        <Fragment>
          <Card withBorder radius="lg" p="lg">
            <Text fw={600} mb="xs">
              Versions
            </Text>
            <Group justify="space-between">
              <Stack gap={4}>
                <Text>
                  WordPress: {data.versions.wp.current} (required ≥{" "}
                  {data.versions.wp.required})
                </Text>
                <Status ok={data.versions.wp.ok} />
              </Stack>
              <Stack gap={4}>
                <Text>
                  PHP: {data.versions.php.current} (required ≥{" "}
                  {data.versions.php.required})
                </Text>
                <Status ok={data.versions.php.ok} />
              </Stack>
            </Group>
          </Card>

          <Card withBorder radius="lg" p="lg">
            <Text fw={600} mb="xs">
              Connectivity
            </Text>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text>
                  REST API:{" "}
                  <Text span c="dimmed">
                    {data.rest.url}
                  </Text>
                </Text>
                <Status ok={data.rest.ok} />
              </Group>
              {data.rest.error && (
                <Text c="red">REST error: {data.rest.error}</Text>
              )}

              <Group justify="space-between" mt="sm">
                <Text>
                  Loopback:{" "}
                  <Text span c="dimmed">
                    {data.loopback.url}
                  </Text>
                </Text>
                <Status ok={data.loopback.ok} />
              </Group>
              {data.loopback.error && (
                <Text c="red">Loopback error: {data.loopback.error}</Text>
              )}
            </Stack>
          </Card>

          <Card withBorder radius="lg" p="lg">
            <Text fw={600} mb="xs">
              Uploads
            </Text>
            <Group justify="space-between">
              <Text>
                Directory:{" "}
                <Text span c="dimmed">
                  {data.uploads.basedir}
                </Text>
              </Text>
              <Status ok={data.uploads.writable} />
            </Group>
            {data.uploads.error && (
              <Text c="red">Uploads error: {data.uploads.error}</Text>
            )}
          </Card>

          <Card withBorder radius="lg" p="lg">
            <Text fw={600} mb="xs">
              SSL & Site URL
            </Text>
            <Group justify="space-between">
              <Text>SSL enabled</Text>
              <Status ok={data.ssl.enabled} />
            </Group>
            <Text c="dimmed">{data.ssl.note}</Text>
            <Text mt="sm">
              Site URL:{" "}
              <Text span c="dimmed">
                {data.siteUrl}
              </Text>
            </Text>
          </Card>
        </Fragment>
      )}
    </Stack>
  );
}
