import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FileInput,
  Group,
  Loader,
  Modal,
  Pagination,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import {
  IconCheck,
  IconArrowDown,
  IconArrowUp,
  IconDeviceFloppy,
  IconDownload,
  IconFileImport,
  IconLanguage,
  IconHelp,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { notifications } from "@mantine/notifications";

import { getWpSuite, TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";
import { __, sprintf } from "@wordpress/i18n";

import {
  canonicalizeCatalogLocale,
  catalogsEqual,
  chooseDefaultLocale,
  cloneCatalog,
  getCatalogKeys,
  isCatalogEmpty,
  normalizeCatalogLocale,
  prepareImport,
  queryCatalogKeys,
  summarizeImport,
  validateCatalog,
  type ImportMode,
  type TranslationCatalog,
} from "./catalog";

type CatalogResponse = {
  catalog: TranslationCatalog;
  defaultLocale: string | null;
  revision: string | number;
  assetUrl?: string;
};

type ActiveCell = { locale: string; key: string; original?: string };
type ConfirmAction =
  | { kind: "discard"; target: null }
  | { kind: "delete"; target: null }
  | { kind: "remove-key"; target: string }
  | {
    kind: "remove-locale";
    target: string;
    nextDefaultLocale: string | null;
    defaultNotice: string;
  }
  | null;

const wpsuite = getWpSuite();

function responseCatalog(input: unknown): CatalogResponse {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("The server returned an invalid response.");
  }
  const response = input as Record<string, unknown>;
  const validation = validateCatalog(response.catalog);
  if (!validation.valid) throw new Error(validation.error);
  if (typeof response.revision !== "string" && typeof response.revision !== "number") {
    throw new Error("The server response is missing its catalog revision.");
  }
  const defaultLocale = typeof response.defaultLocale === "string"
    ? chooseDefaultLocale(validation.catalog, response.defaultLocale)
    : response.defaultLocale === null
      ? null
      : undefined;
  if (
    defaultLocale === undefined
    || (Object.keys(validation.catalog).length > 0 && defaultLocale === null)
    || (typeof response.defaultLocale === "string" && defaultLocale !== response.defaultLocale)
  ) {
    throw new Error("The server response has an invalid default locale.");
  }
  return {
    catalog: validation.catalog,
    defaultLocale,
    revision: response.revision,
    assetUrl: typeof response.assetUrl === "string" ? response.assetUrl : undefined,
  };
}

type TranslationCatalogEditorProps = { onOpenHelp?: () => void };

export function TranslationCatalogEditor({ onOpenHelp }: TranslationCatalogEditorProps) {
  const [baseline, setBaseline] = useState<TranslationCatalog>({});
  const [draft, setDraft] = useState<TranslationCatalog>({});
  const [baselineDefaultLocale, setBaselineDefaultLocale] = useState<string | null>(null);
  const [draftDefaultLocale, setDraftDefaultLocale] = useState<string | null>(null);
  const [revision, setRevision] = useState<string | number | null>(null);
  const [assetUrl, setAssetUrl] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [filterLocale, setFilterLocale] = useState("all");
  const [sortBy, setSortBy] = useState("key");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [newLocale, setNewLocale] = useState("");
  const [newKey, setNewKey] = useState("");
  const [activeCell, setActiveCell] = useState<ActiveCell>();
  const [editValue, setEditValue] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("merge-skip");
  const [validatedImport, setValidatedImport] = useState<TranslationCatalog>();
  const [importError, setImportError] = useState<string>();

  const dirty = useMemo(
    () => !catalogsEqual(baseline, draft) || baselineDefaultLocale !== draftDefaultLocale,
    [baseline, baselineDefaultLocale, draft, draftDefaultLocale],
  );
  const locales = useMemo(() => {
    const sorted = Object.keys(draft).sort();
    if (!draftDefaultLocale) return sorted;
    return [draftDefaultLocale, ...sorted.filter((locale) => locale !== draftDefaultLocale)];
  }, [draft, draftDefaultLocale]);
  const allKeys = useMemo(() => getCatalogKeys(draft), [draft]);
  const activeFilterLocale = filterLocale !== "all" && locales.includes(filterLocale)
    ? filterLocale
    : "all";
  const activeSortBy = sortBy !== "key" && !locales.includes(sortBy)
    ? "key"
    : sortBy;
  const filteredKeys = useMemo(
    () => queryCatalogKeys(draft, {
      search,
      locale: activeFilterLocale === "all" ? null : activeFilterLocale,
      missingOnly,
      sortBy: activeSortBy,
      sortDirection,
    }),
    [activeFilterLocale, activeSortBy, draft, missingOnly, search, sortDirection],
  );
  const totalPages = Math.max(1, Math.ceil(filteredKeys.length / pageSize));
  const activePage = Math.min(page, totalPages);
  const pagedKeys = useMemo(
    () => filteredKeys.slice((activePage - 1) * pageSize, activePage * pageSize),
    [activePage, filteredKeys, pageSize],
  );
  const firstVisibleRow = filteredKeys.length === 0 ? 0 : (activePage - 1) * pageSize + 1;
  const lastVisibleRow = Math.min(activePage * pageSize, filteredKeys.length);
  const importSummary = useMemo(
    () => validatedImport
      ? summarizeImport(draft, validatedImport, importMode)
      : undefined,
    [draft, importMode, validatedImport],
  );
  const preparedImport = useMemo(
    () => validatedImport
      ? prepareImport(draft, validatedImport, importMode)
      : undefined,
    [draft, importMode, validatedImport],
  );
  const preparedImportDefaultLocale = useMemo(
    () => preparedImport?.valid
      ? chooseDefaultLocale(preparedImport.catalog, draftDefaultLocale)
      : null,
    [draftDefaultLocale, preparedImport],
  );
  const initializeBlocked = importMode === "initialize"
    && (!isCatalogEmpty(baseline) || !isCatalogEmpty(draft));

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${wpsuite!.restUrl}/custom-translations`, {
      credentials: "same-origin",
      headers: { "X-WP-Nonce": wpsuite!.nonce },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Could not load the catalog (HTTP ${response.status}).`);
        }
        return responseCatalog(await response.json());
      })
      .then((data) => {
        setBaseline(cloneCatalog(data.catalog));
        setDraft(cloneCatalog(data.catalog));
        setBaselineDefaultLocale(data.defaultLocale);
        setDraftDefaultLocale(data.defaultLocale);
        setRevision(data.revision);
        setAssetUrl(data.assetUrl);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError((caught as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  const save = useCallback(async () => {
    if (revision === null) return;
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch(`${wpsuite!.restUrl}/custom-translations`, {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(revision),
          "X-WP-Nonce": wpsuite!.nonce,
        },
        body: JSON.stringify({ catalog: draft, defaultLocale: draftDefaultLocale }),
      });
      if (response.status === 409 || response.status === 412) {
        throw new Error("The catalog changed in another session. Reload it before saving.");
      }
      if (!response.ok) throw new Error(`Could not save the catalog (HTTP ${response.status}).`);
      const data = responseCatalog(await response.json());
      setBaseline(cloneCatalog(data.catalog));
      setDraft(cloneCatalog(data.catalog));
      setBaselineDefaultLocale(data.defaultLocale);
      setDraftDefaultLocale(data.defaultLocale);
      setRevision(data.revision);
      setAssetUrl(data.assetUrl);
      setActiveCell(undefined);
      notifications.show({
        title: __("Translations saved", TEXT_DOMAIN),
        message: __("The shared translation catalog is now up to date.", TEXT_DOMAIN),
        color: "green",
      });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }, [draft, draftDefaultLocale, revision]);

  const deleteCatalog = useCallback(async () => {
    if (revision === null) return;
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch(`${wpsuite!.restUrl}/custom-translations`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          "If-Match": String(revision),
          "X-WP-Nonce": wpsuite!.nonce,
        },
      });
      if (response.status === 409 || response.status === 412) {
        throw new Error("The catalog changed in another session. Reload it before deleting.");
      }
      if (!response.ok) throw new Error(`Could not delete the catalog (HTTP ${response.status}).`);
      const data = responseCatalog(await response.json());
      setBaseline(cloneCatalog(data.catalog));
      setDraft(cloneCatalog(data.catalog));
      setBaselineDefaultLocale(data.defaultLocale);
      setDraftDefaultLocale(data.defaultLocale);
      setRevision(data.revision);
      setAssetUrl(data.assetUrl);
      setActiveCell(undefined);
      setConfirmAction(null);
      notifications.show({
        title: __("Catalog deleted", TEXT_DOMAIN),
        message: __("The saved custom translations were removed.", TEXT_DOMAIN),
        color: "green",
      });
    } catch (caught) {
      setError((caught as Error).message);
      setConfirmAction(null);
    } finally {
      setSaving(false);
    }
  }, [revision]);

  const addLocale = () => {
    const enteredLocale = newLocale.trim();
    if (!enteredLocale) return;
    const normalizedLocale = normalizeCatalogLocale(enteredLocale);
    const locale = canonicalizeCatalogLocale(enteredLocale);
    if (!normalizedLocale || !locale) {
      setError(`“${enteredLocale}” is not a valid locale code.`);
      return;
    }
    if (Object.keys(draft).some(
      (existingLocale) => normalizeCatalogLocale(existingLocale) === normalizedLocale,
    )) {
      setError(`Locale “${enteredLocale}” already exists.`);
      return;
    }
    setDraft((current) => ({ ...current, [locale]: {} }));
    if (draftDefaultLocale === null) setDraftDefaultLocale(locale);
    setNewLocale("");
    setError(undefined);
  };

  const addKey = () => {
    const key = newKey;
    if (!key.trim() || locales.length === 0) return;
    if (allKeys.includes(key)) {
      setError(`Key “${key}” already exists.`);
      return;
    }
    const firstLocale = draftDefaultLocale ?? locales[0];
    setDraft((current) => ({
      ...current,
      [firstLocale]: { ...current[firstLocale], [key]: key },
    }));
    setNewKey("");
    setError(undefined);
  };

  const requestRemoveLocale = (locale: string) => {
    const next = cloneCatalog(draft);
    delete next[locale];
    const nextDefault = chooseDefaultLocale(
      next,
      locale === draftDefaultLocale ? null : draftDefaultLocale,
    );
    const defaultNotice = locale === draftDefaultLocale
      ? nextDefault
        ? sprintf(__(" The default locale will change to %s.", TEXT_DOMAIN), `“${nextDefault}”`)
        : __(" The catalog will no longer have a default locale.", TEXT_DOMAIN)
      : "";
    setConfirmAction({
      kind: "remove-locale",
      target: locale,
      nextDefaultLocale: nextDefault,
      defaultNotice,
    });
  };

  const requestRemoveKey = (key: string) => {
    setConfirmAction({ kind: "remove-key", target: key });
  };

  const requestDiscardChanges = () => setConfirmAction({ kind: "discard", target: null });

  const requestDeleteCatalog = () => setConfirmAction({ kind: "delete", target: null });

  const executeConfirmAction = () => {
    if (confirmAction === null) return;

    if (confirmAction.kind === "delete") {
      void deleteCatalog();
      return;
    }

    if (confirmAction.kind === "discard") {
      setDraft(cloneCatalog(baseline));
      setDraftDefaultLocale(baselineDefaultLocale);
      setActiveCell(undefined);
      setConfirmAction(null);
      return;
    }

    if (confirmAction.kind === "remove-key") {
      const key = confirmAction.target;
      setDraft((current) => Object.fromEntries(
        Object.entries(current).map(([locale, dictionary]) => {
          const next = { ...dictionary };
          delete next[key];
          return [locale, next];
        }),
      ));
      setActiveCell(undefined);
      setConfirmAction(null);
      return;
    }

    setDraft((current) => {
      const next = cloneCatalog(current);
      delete next[confirmAction.target];
      return next;
    });
    setDraftDefaultLocale(confirmAction.nextDefaultLocale);
    setActiveCell(undefined);
    setConfirmAction(null);
  };

  const beginEdit = (locale: string, key: string) => {
    const exists = Object.prototype.hasOwnProperty.call(draft[locale], key);
    const original = exists ? draft[locale][key] : undefined;
    setActiveCell({ locale, key, original });
    setEditValue(original ?? "");
  };

  const commitCell = () => {
    if (!activeCell) return;
    const { locale, key } = activeCell;
    setDraft((current) => ({
      ...current,
      [locale]: { ...current[locale], [key]: editValue },
    }));
    setActiveCell(undefined);
  };

  const useFallback = () => {
    if (!activeCell) return;
    const { locale, key } = activeCell;
    setDraft((current) => {
      const dictionary = { ...current[locale] };
      delete dictionary[key];
      return { ...current, [locale]: dictionary };
    });
    setActiveCell(undefined);
  };

  const validateImportFile = async () => {
    setValidatedImport(undefined);
    setImportError(undefined);
    if (!importFile) return;
    try {
      const parsed: unknown = JSON.parse(await importFile.text());
      const validation = validateCatalog(parsed);
      if (!validation.valid) throw new Error(validation.error);
      setValidatedImport(validation.catalog);
    } catch (caught) {
      setImportError(
        caught instanceof SyntaxError
          ? "The selected file is not valid JSON."
          : (caught as Error).message,
      );
    }
  };

  const applyValidatedImport = () => {
    if (!preparedImport?.valid || initializeBlocked) return;
    setDraft(cloneCatalog(preparedImport.catalog));
    setDraftDefaultLocale(preparedImportDefaultLocale);
    setImportOpen(false);
    setImportFile(null);
    setValidatedImport(undefined);
    setImportError(undefined);
  };

  const exportDraft = () => {
    const blob = new Blob([`${JSON.stringify(draft, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "wpsuite-custom-translations.draft.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <Card withBorder radius="lg" p="lg">
        <Group><Loader size="sm" /><Text>{__("Loading custom translations…", TEXT_DOMAIN)}</Text></Group>
      </Card>
    );
  }

  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="xs">
              <Text fw={600}>{__("Custom Translations", TEXT_DOMAIN)}</Text>
              {dirty && <Badge color="yellow">{__("Modified", TEXT_DOMAIN)}</Badge>}
              {onOpenHelp && (
                <ActionIcon variant="subtle" size="sm" aria-label={__("Open documentation for custom translations", TEXT_DOMAIN)} onClick={onOpenHelp}>
                  <IconHelp size={14} />
                </ActionIcon>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              {__("Edit the shared translation catalog for every WP Suite plugin on this site.", TEXT_DOMAIN)}
            </Text>
          </div>
          <Group gap="xs">
            {assetUrl && (
              <Button component="a" href={assetUrl} download variant="light" leftSection={<IconDownload size={16} />}>
                {__("Download saved JSON", TEXT_DOMAIN)}
              </Button>
            )}
            <Button variant="light" leftSection={<IconDownload size={16} />} onClick={exportDraft}>
              {__("Export draft", TEXT_DOMAIN)}
            </Button>
            <Button variant="light" leftSection={<IconFileImport size={16} />} onClick={() => setImportOpen(true)}>
              {__("Import JSON", TEXT_DOMAIN)}
            </Button>
          </Group>
        </Group>

        {error && <Alert color="red" title={__("Translation catalog error", TEXT_DOMAIN)}>{error}</Alert>}

        <Group align="flex-end">
          <Select
            label={__("Default locale", TEXT_DOMAIN)}
            description={__("Missing translations fall back to this locale before English.", TEXT_DOMAIN)}
            data={locales}
            value={draftDefaultLocale}
            onChange={(value) => setDraftDefaultLocale(value)}
            allowDeselect={false}
            disabled={locales.length === 0}
          />
          <TextInput
            label={__("Add locale", TEXT_DOMAIN)}
            placeholder={__("e.g. hu-HU", TEXT_DOMAIN)}
            value={newLocale}
            onChange={(event) => setNewLocale(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === "Enter") addLocale(); }}
          />
          <Button variant="light" leftSection={<IconLanguage size={16} />} onClick={addLocale} disabled={!newLocale.trim()}>
            {__("Add locale", TEXT_DOMAIN)}
          </Button>
          <TextInput
            label={__("Add key", TEXT_DOMAIN)}
            placeholder={__("Original text", TEXT_DOMAIN)}
            value={newKey}
            onChange={(event) => setNewKey(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === "Enter") addKey(); }}
            disabled={locales.length === 0}
          />
          <Button variant="light" leftSection={<IconPlus size={16} />} onClick={addKey} disabled={!newKey.trim() || locales.length === 0}>
            {__("Add key", TEXT_DOMAIN)}
          </Button>
        </Group>

        <Group align="flex-end">
          <TextInput
            label={__("Search", TEXT_DOMAIN)}
            placeholder={__("Search keys and translations…", TEXT_DOMAIN)}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPage(1);
            }}
            style={{ flex: 1 }}
          />
          <Select
            label={__("Filter locale", TEXT_DOMAIN)}
            data={[
              { value: "all", label: __("All locales", TEXT_DOMAIN) },
              ...locales.map((locale) => ({ value: locale, label: locale })),
            ]}
            value={activeFilterLocale}
            onChange={(value) => {
              setFilterLocale(value ?? "all");
              setPage(1);
            }}
            allowDeselect={false}
            disabled={locales.length === 0}
          />
          <Checkbox
            label={__("Show only keys with missing translations", TEXT_DOMAIN)}
            checked={missingOnly}
            onChange={(event) => {
              setMissingOnly(event.currentTarget.checked);
              setPage(1);
            }}
          />
        </Group>

        <Group align="flex-end">
          <Select
            label={__("Sort by", TEXT_DOMAIN)}
            data={[
              { value: "key", label: __("Translation key", TEXT_DOMAIN) },
              ...locales.map((locale) => ({ value: locale, label: locale })),
            ]}
            value={activeSortBy}
            onChange={(value) => {
              setSortBy(value ?? "key");
              setPage(1);
            }}
            allowDeselect={false}
            disabled={locales.length === 0}
          />
          <ActionIcon
            variant="default"
            size={36}
            aria-label={sortDirection === "asc"
              ? __("Sort descending", TEXT_DOMAIN)
              : __("Sort ascending", TEXT_DOMAIN)}
            onClick={() => {
              setSortDirection((current) => current === "asc" ? "desc" : "asc");
              setPage(1);
            }}
          >
            {sortDirection === "asc" ? <IconArrowUp size={16} /> : <IconArrowDown size={16} />}
          </ActionIcon>
          <Select
            label={__("Rows per page", TEXT_DOMAIN)}
            data={["10", "20", "50", "100"]}
            value={String(pageSize)}
            onChange={(value) => {
              setPageSize(Number(value ?? 10));
              setPage(1);
            }}
            allowDeselect={false}
          />
        </Group>

        {locales.length === 0 ? (
          <Alert color="blue" title={__("Start by adding a locale", TEXT_DOMAIN)}>
            {__("Add a locale manually or initialize the catalog from a JSON file.", TEXT_DOMAIN)}
          </Alert>
        ) : (
          <Table.ScrollContainer minWidth={Math.max(720, 300 + locales.length * 240)} type="native">
            <Table withTableBorder withColumnBorders highlightOnHover verticalSpacing="xs">
              <Table.Thead style={{ position: "sticky", top: 0, zIndex: 3, background: "var(--mantine-color-body)" }}>
                <Table.Tr>
                  <Table.Th style={{ position: "sticky", left: 0, zIndex: 4, minWidth: 280, background: "var(--mantine-color-body)" }}>
                    {__("Translation key", TEXT_DOMAIN)}
                  </Table.Th>
                  {locales.map((locale) => (
                    <Table.Th key={locale} miw={220}>
                      <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs" wrap="nowrap">
                          <Text fw={600}>{locale}</Text>
                          {locale === draftDefaultLocale && (
                            <Badge size="xs" variant="light">{__("Default", TEXT_DOMAIN)}</Badge>
                          )}
                        </Group>
                        <ActionIcon color="red" variant="subtle" aria-label={`Remove locale ${locale}`} onClick={() => requestRemoveLocale(locale)}>
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Group>
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pagedKeys.map((key) => (
                  <Table.Tr key={key}>
                    <Table.Th style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--mantine-color-body)" }}>
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{key}</Text>
                        <ActionIcon color="red" variant="subtle" aria-label={`Remove key ${key}`} onClick={() => requestRemoveKey(key)}>
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Group>
                    </Table.Th>
                    {locales.map((locale) => {
                      const exists = Object.prototype.hasOwnProperty.call(draft[locale], key);
                      const value = draft[locale][key];
                      const editing = activeCell?.locale === locale && activeCell.key === key;
                      return (
                        <Table.Td key={locale} style={{ verticalAlign: "top" }}>
                          {editing ? (
                            <Stack gap={4}>
                              <Textarea
                                autoFocus
                                autosize
                                minRows={1}
                                maxRows={8}
                                aria-label={`Translation for ${key} in ${locale}`}
                                value={editValue}
                                onChange={(event) => setEditValue(event.currentTarget.value)}
                                onKeyDown={(event) => {
                                  if (event.nativeEvent.isComposing) return;
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    setActiveCell(undefined);
                                  } else if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    commitCell();
                                  }
                                }}
                              />
                              <Group gap={4}>
                                <ActionIcon color="green" variant="subtle" aria-label={__("Commit cell", TEXT_DOMAIN)} onClick={commitCell}><IconCheck size={15} /></ActionIcon>
                                <ActionIcon variant="subtle" aria-label={__("Cancel editing", TEXT_DOMAIN)} onClick={() => setActiveCell(undefined)}><IconX size={15} /></ActionIcon>
                                <Button size="compact-xs" variant="subtle" onClick={useFallback}>{__("Use fallback", TEXT_DOMAIN)}</Button>
                              </Group>
                              <Text size="xs" c="dimmed">{__("Enter applies; Shift+Enter adds a line.", TEXT_DOMAIN)}</Text>
                            </Stack>
                          ) : (
                            <Button
                              variant="subtle"
                              color={exists ? undefined : "gray"}
                              fullWidth
                              justify="flex-start"
                              onClick={() => beginEdit(locale, key)}
                              aria-label={`Edit translation for ${key} in ${locale}`}
                              styles={{ inner: { justifyContent: "flex-start" }, label: { whiteSpace: "pre-wrap", textAlign: "left", overflowWrap: "anywhere" } }}
                            >
                              {!exists ? <Badge color="gray" variant="light">{__("Missing", TEXT_DOMAIN)}</Badge> : value === "" ? <Badge color="blue" variant="light">{__("Explicitly empty", TEXT_DOMAIN)}</Badge> : value}
                            </Button>
                          )}
                        </Table.Td>
                      );
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        {locales.length > 0 && filteredKeys.length === 0 && (
          <Text c="dimmed" ta="center">{__("No translation keys match the current filters.", TEXT_DOMAIN)}</Text>
        )}

        {filteredKeys.length > 0 && (
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">
              {sprintf(
                __("Showing %1$d–%2$d of %3$d. Page %4$d of %5$d.", TEXT_DOMAIN),
                firstVisibleRow,
                lastVisibleRow,
                filteredKeys.length,
                activePage,
                totalPages,
              )}
            </Text>
            <Pagination value={activePage} onChange={setPage} total={totalPages} withEdges />
          </Group>
        )}

        <Group justify="space-between">
          <Button color="red" variant="subtle" leftSection={<IconTrash size={16} />} onClick={requestDeleteCatalog} disabled={saving || isCatalogEmpty(baseline)}>
            {__("Delete catalog", TEXT_DOMAIN)}
          </Button>
          <Group>
            {dirty && <Button variant="default" onClick={requestDiscardChanges}>{__("Discard changes", TEXT_DOMAIN)}</Button>}
            <Button leftSection={<IconDeviceFloppy size={16} />} onClick={() => void save()} loading={saving} disabled={!dirty || revision === null}>
              {__("Save all changes", TEXT_DOMAIN)}
            </Button>
          </Group>
        </Group>
        <Text size="xs" c="dimmed" role="status" aria-live="polite">
          {dirty ? __("There are unsaved catalog changes.", TEXT_DOMAIN) : __("All catalog changes are saved.", TEXT_DOMAIN)}
        </Text>
      </Stack>

      <Modal
        opened={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={
          confirmAction?.kind === "delete"
            ? __("Delete translation catalog?", TEXT_DOMAIN)
            : confirmAction?.kind === "discard"
              ? __("Discard unsaved changes?", TEXT_DOMAIN)
              : confirmAction?.kind === "remove-key"
                ? sprintf(__("Remove translation key %s?", TEXT_DOMAIN), `“${confirmAction.target}”`)
                : confirmAction?.kind === "remove-locale"
                  ? sprintf(__("Remove locale %s?", TEXT_DOMAIN), `“${confirmAction.target}”`)
                  : ""
        }
        centered
      >
        <Stack>
          <Text>
            {confirmAction?.kind === "delete"
              ? __("This removes every saved custom translation for this site.", TEXT_DOMAIN)
              : confirmAction?.kind === "discard"
                ? __("The editor will return to the last saved version.", TEXT_DOMAIN)
                : confirmAction?.kind === "remove-key"
                  ? sprintf(
                    __("This permanently removes translation key %s from every locale in the draft.", TEXT_DOMAIN),
                    `“${confirmAction.target}”`,
                  )
                  : sprintf(
                    __("This removes all translations for locale %s.", TEXT_DOMAIN),
                    `“${confirmAction?.target}”`,
                  ) + confirmAction?.defaultNotice
            }
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmAction(null)}>{__("Cancel", TEXT_DOMAIN)}</Button>
            <Button
              color={confirmAction?.kind === "discard" ? "gray" : "red"}
              loading={saving}
              onClick={executeConfirmAction}
            >
              {confirmAction?.kind === "delete"
                ? __("Delete catalog", TEXT_DOMAIN)
                : confirmAction?.kind === "discard"
                  ? __("Discard changes", TEXT_DOMAIN)
                  : confirmAction?.kind === "remove-key"
                    ? __("Remove key", TEXT_DOMAIN)
                    : __("Remove locale", TEXT_DOMAIN)}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={importOpen} onClose={() => setImportOpen(false)} title={__("Import translation catalog", TEXT_DOMAIN)} size="lg" centered>
        <Stack>
          <SegmentedControl
            fullWidth
            value={importMode}
            onChange={(value) => setImportMode(value as ImportMode)}
            data={[
              { label: __("Initialize", TEXT_DOMAIN), value: "initialize" },
              { label: __("Merge, skip conflicts", TEXT_DOMAIN), value: "merge-skip" },
              { label: __("Merge, overwrite", TEXT_DOMAIN), value: "merge-overwrite" },
            ]}
          />
          <Text size="sm" c="dimmed">
            {__("Initialize requires an empty catalog. Merge keeps existing values or overwrites them according to the selected conflict rule.", TEXT_DOMAIN)}
          </Text>
          <FileInput
            label={__("JSON file", TEXT_DOMAIN)}
            placeholder={__("Choose a .json file", TEXT_DOMAIN)}
            accept="application/json,.json"
            value={importFile}
            onChange={(file) => {
              setImportFile(file);
              setValidatedImport(undefined);
              setImportError(undefined);
            }}
            clearable
          />
          <Button variant="light" onClick={() => void validateImportFile()} disabled={!importFile}>
            {__("Validate and preview", TEXT_DOMAIN)}
          </Button>
          {importError && <Alert color="red" title={__("Invalid import", TEXT_DOMAIN)}>{importError}</Alert>}
          {validatedImport && importSummary && (
            <Alert color={initializeBlocked ? "red" : "blue"} title={__("Import preview", TEXT_DOMAIN)}>
              <Stack gap={4}>
                {initializeBlocked && <Text size="sm">{__("Initialize cannot be applied because the saved catalog or current draft is not empty.", TEXT_DOMAIN)}</Text>}
                {preparedImport && !preparedImport.valid && <Text size="sm">{preparedImport.error}</Text>}
                <Text size="sm">{Object.keys(validatedImport).length} locales; {getCatalogKeys(validatedImport).length} keys.</Text>
                <Text size="sm">
                  {importSummary.additions} additions, {importSummary.conflicts} conflicts, {importSummary.overwrites} overwrites, {importSummary.skips} skipped, {importSummary.unchanged} unchanged.
                </Text>
                <Text size="sm">{__("Applying this preview changes only the local draft. Use Save all changes to persist it.", TEXT_DOMAIN)}</Text>
              </Stack>
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setImportOpen(false)}>{__("Cancel", TEXT_DOMAIN)}</Button>
            <Button onClick={applyValidatedImport} disabled={!preparedImport?.valid || initializeBlocked}>{__("Apply to draft", TEXT_DOMAIN)}</Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
