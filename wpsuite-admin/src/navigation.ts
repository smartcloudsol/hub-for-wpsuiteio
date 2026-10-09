/** Admin-owned projection of the versioned PHP navigation registry. */
export interface NavigationLink {
  label: string;
  url: string;
}

export interface NavigationCapability {
  id: string;
  label: string;
  product: string;
  description: string;
  url: string;
  surface_url?: string | null;
  reset_url?: string | null;
  surface_extension?: string | null;
  has_details?: boolean;
  show_in_overview?: boolean;
  primary: NavigationLink | null;
  quick_links: NavigationLink[];
  advanced_links: NavigationLink[];
}

export interface DiscoveryCapability {
  id: string;
  label: string;
  product: string;
  description: string;
  state: "not_installed" | "inactive" | "legacy";
  action: NavigationLink | null;
  message: string;
}

export interface NavigationBootstrap {
  schema_version: 1;
  view: "overview" | "advanced" | "capability";
  active_id?: string;
  overview_url: string;
  advanced_url: string;
  can_manage_connection: boolean;
  rest_nonce?: string;
  capabilities: NavigationCapability[];
  platform_links: NavigationLink[];
  discovery: DiscoveryCapability[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  // PHP supplies permission-filtered admin URLs. Reject executable schemes,
  // including control-character obfuscation, if malformed data reaches the DOM.
  if ([...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === "\\")) return false;
  try {
    const url = new URL(value, "https://wordpress.invalid/wp-admin/");
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isLink(value: unknown): value is NavigationLink {
  return isRecord(value) && typeof value.label === "string" && isUrl(value.url);
}

function isLinks(value: unknown): value is NavigationLink[] {
  return Array.isArray(value) && value.every(isLink);
}

function isCapability(value: unknown): value is NavigationCapability {
  return isRecord(value)
    && ["id", "label", "product", "description"].every(key => typeof value[key] === "string")
    && isUrl(value.url)
    && (value.surface_url === undefined || value.surface_url === null || isUrl(value.surface_url))
    && (value.reset_url === undefined || value.reset_url === null || isUrl(value.reset_url))
    && (value.surface_extension === undefined || value.surface_extension === null || (typeof value.surface_extension === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value.surface_extension)))
    && (value.has_details === undefined || typeof value.has_details === "boolean")
    && (value.show_in_overview === undefined || typeof value.show_in_overview === "boolean")
    && (value.primary === null || isLink(value.primary))
    && isLinks(value.quick_links)
    && isLinks(value.advanced_links);
}

function isDiscovery(value: unknown): value is DiscoveryCapability {
  return isRecord(value)
    && ["id", "label", "product", "description", "message"].every(key => typeof value[key] === "string")
    && ["not_installed", "inactive", "legacy"].includes(value.state as string)
    && (value.action === null || isLink(value.action));
}

/** Invalid/newer bootstraps fail closed rather than mounting connection UI. */
export function parseNavigation(raw: string): NavigationBootstrap | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)
      || value.schema_version !== 1
      || !["overview", "advanced", "capability"].includes(value.view as string)
      || (value.active_id !== undefined && typeof value.active_id !== "string")
      || !isUrl(value.overview_url)
      || !isUrl(value.advanced_url)
      || (value.rest_nonce !== undefined && (typeof value.rest_nonce !== "string" || !value.rest_nonce))
      || typeof value.can_manage_connection !== "boolean"
      || !Array.isArray(value.capabilities)
      || !value.capabilities.every(isCapability)
      || !isLinks(value.platform_links)
      || !Array.isArray(value.discovery)
      || !value.discovery.every(isDiscovery)) return null;
    return value as unknown as NavigationBootstrap;
  } catch {
    return null;
  }
}

export function groupAdvancedLinks(capabilities: NavigationCapability[]): Map<string, NavigationLink[]> {
  const groups = new Map<string, NavigationLink[]>();
  for (const capability of capabilities) {
    const links = groups.get(capability.product) ?? [];
    for (const link of [...capability.quick_links, ...capability.advanced_links]) {
      if (!links.some(existing => existing.url === link.url)) links.push(link);
    }
    if (links.length) groups.set(capability.product, links);
  }
  return groups;
}

/** Keep the first, most specific label for each exact destination. */
export function uniqueLinks(...groups: NavigationLink[][]): NavigationLink[] {
  const links = new Map<string, NavigationLink>();
  for (const link of groups.flat()) if (!links.has(link.url)) links.set(link.url, link);
  return [...links.values()];
}

export type SurfaceValue = string | number | boolean;
export interface SurfaceIntroduction { title: string; description: string; items: { title: string; description: string }[] }
export interface SurfaceHelpTopic { id: string; title: string; summary: string; paragraphs: string[] }
export interface SurfaceField {
  id: string;
  label: string;
  type: "text" | "url" | "number" | "checkbox" | "select";
  description?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  suggestions_url?: string;
  help_id?: string;
}
export interface SurfaceStep { id: string; title: string; description?: string; help_id?: string; fields: SurfaceField[] }
export interface SurfaceAction { id: string; label: string; confirm?: string; fields: SurfaceField[] }
export interface RuntimeField { label: string; path: string; format: "text" | "boolean" | "count" }
export interface SiteUse {
  description: string;
  items: { id: string; title: string; description: string; status?: string; help_id?: string; links: NavigationLink[] }[];
}
export interface CapabilitySurface {
  schema_version: 1;
  configured: boolean;
  can_edit: boolean;
  can_setup?: boolean;
  revision: string;
  status: { state: "ready" | "needs_setup" | "unavailable"; label: string };
  notice: string;
  metrics: { label: string; value: SurfaceValue; help_id?: string }[];
  values: Record<string, SurfaceValue>;
  steps: SurfaceStep[];
  actions: SurfaceAction[];
  links: NavigationLink[];
  primary_link?: NavigationLink;
  runtime_plugin?: string;
  runtime_fields?: RuntimeField[];
  use_on_site?: SiteUse;
  help?: SurfaceHelpTopic[];
  introduction?: SurfaceIntroduction;
}

const safeKey = (key: string): boolean => !["__proto__", "constructor", "prototype"].includes(key);
const helpId = (value: unknown): boolean => value === undefined || (typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value));
const scalar = (value: unknown): value is SurfaceValue => typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
const unique = (values: string[]): boolean => new Set(values).size === values.length;
function isField(value: unknown): value is SurfaceField {
  return isRecord(value) && typeof value.id === "string" && /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(value.id) && safeKey(value.id)
    && typeof value.label === "string" && ["text", "url", "number", "checkbox", "select"].includes(value.type as string)
    && helpId(value.help_id)
    && (value.description === undefined || typeof value.description === "string")
    && (value.required === undefined || typeof value.required === "boolean")
    && (value.suggestions_url === undefined || (value.type === "text" && typeof value.suggestions_url === "string"))
    && (value.options === undefined || (Array.isArray(value.options) && value.options.every(option => isRecord(option) && typeof option.label === "string" && typeof option.value === "string")
      && unique(value.options.map(option => option.value as string))));
}
function isFields(value: unknown): value is SurfaceField[] {
  return Array.isArray(value) && value.every(isField) && unique(value.map(field => field.id));
}
function isRuntimeField(value: unknown): value is RuntimeField {
  return isRecord(value) && typeof value.label === "string" && typeof value.path === "string"
    && /^[a-zA-Z][a-zA-Z0-9_.]*$/.test(value.path) && value.path.split(".").every(part => part.length > 0 && safeKey(part))
    && ["text", "boolean", "count"].includes(value.format as string);
}

function isSiteUse(value: unknown): value is SiteUse {
  return isRecord(value) && typeof value.description === "string" && value.description.length <= 4096
    && Array.isArray(value.items) && value.items.length <= 12
    && value.items.every(item => isRecord(item) && typeof item.id === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(item.id)
      && typeof item.title === "string" && item.title.length <= 256
      && typeof item.description === "string" && item.description.length <= 4096
      && (item.status === undefined || (typeof item.status === "string" && item.status.length <= 1024))
      && helpId(item.help_id) && isLinks(item.links) && item.links.length <= 8)
    && unique(value.items.map(item => item.id as string));
}

/** Rich provider data must be valid before rendering any editable controls. */
export function parseSurface(value: unknown): CapabilitySurface | null {
  if (!isRecord(value) || value.schema_version !== 1 || typeof value.configured !== "boolean" || typeof value.can_edit !== "boolean"
    || (Object.hasOwn(value, "can_setup") && typeof value.can_setup !== "boolean")
    || typeof value.revision !== "string" || (value.can_edit && !value.revision)
    || !isRecord(value.status) || !["ready", "needs_setup", "unavailable"].includes(value.status.state as string) || typeof value.status.label !== "string"
    || typeof value.notice !== "string" || !Array.isArray(value.metrics)
    || !value.metrics.every(metric => isRecord(metric) && typeof metric.label === "string" && scalar(metric.value) && helpId(metric.help_id))
    || !isRecord(value.values) || !Object.entries(value.values).every(([key, fieldValue]) => safeKey(key) && scalar(fieldValue))
    || !Array.isArray(value.steps) || !value.steps.every(step => isRecord(step) && typeof step.id === "string" && typeof step.title === "string"
      && helpId(step.help_id) && (step.description === undefined || typeof step.description === "string") && isFields(step.fields))
    || !Array.isArray(value.actions) || !value.actions.every(action => isRecord(action) && typeof action.id === "string" && typeof action.label === "string"
      && (action.confirm === undefined || typeof action.confirm === "string") && isFields(action.fields))
    || !isLinks(value.links)
    || (value.primary_link !== undefined && !isLink(value.primary_link))
    || (value.use_on_site !== undefined && !isSiteUse(value.use_on_site))
    || (value.help !== undefined && (!Array.isArray(value.help) || value.help.length > 32 || !value.help.every(topic => isRecord(topic)
      && typeof topic.id === "string" && helpId(topic.id) && typeof topic.title === "string" && topic.title.length <= 256
      && typeof topic.summary === "string" && topic.summary.length <= 1024 && Array.isArray(topic.paragraphs) && topic.paragraphs.length <= 8
      && topic.paragraphs.every(text => typeof text === "string" && text.length <= 4096)) || !unique(value.help.map(topic => topic.id as string))))
    || (value.runtime_plugin !== undefined && (typeof value.runtime_plugin !== "string" || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(value.runtime_plugin)))
    || (value.runtime_fields !== undefined && (!value.runtime_plugin || !Array.isArray(value.runtime_fields) || !value.runtime_fields.every(isRuntimeField)))) return null;
  if (value.introduction !== undefined) {
    const intro = value.introduction;
    if (!isRecord(intro) || typeof intro.title !== "string" || intro.title.length > 256 || typeof intro.description !== "string" || intro.description.length > 4096
      || !Array.isArray(intro.items) || intro.items.length > 8 || !intro.items.every(item => isRecord(item) && typeof item.title === "string" && item.title.length <= 256 && typeof item.description === "string" && item.description.length <= 4096)) return null;
  }
  const surface = value as unknown as CapabilitySurface;
  const fields = surface.steps.flatMap(step => step.fields);
  if (!unique(surface.steps.map(step => step.id)) || !unique(surface.actions.map(action => action.id)) || !unique(fields.map(field => field.id))) return null;
  if (Object.keys(surface.values).some(key => !fields.some(field => field.id === key))) return null;
  for (const field of fields) {
    const current = surface.values[field.id];
    if (current === undefined || (field.type === "checkbox" ? typeof current !== "boolean"
      : field.type === "number" ? typeof current !== "number" && current !== "" : typeof current !== "string")) return null;
  }
  return surface;
}

/** Only declared local form fields enter a patch; hidden canonical state stays server-owned. */
export function surfaceDraft(fields: SurfaceField[], values: Record<string, SurfaceValue> = {}): Record<string, SurfaceValue> {
  return Object.fromEntries(fields.map(field => [field.id, values[field.id] ?? (field.type === "checkbox" ? false : "")]));
}

export function runtimeValue(config: unknown, field: RuntimeField): SurfaceValue | null {
  if (!isRuntimeField(field)) return null;
  let value: unknown = config;
  for (const part of field.path.split(".")) {
    if (!isRecord(value) || !Object.hasOwn(value, part)) return null;
    value = value[part];
  }
  if (field.format === "count") return Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : null;
  if (field.format === "boolean") return typeof value === "boolean" ? value : null;
  return scalar(value) ? value : null;
}

/** Surface transport is always same-origin, including plain-permalink REST URLs. */
export function surfaceEndpoint(raw: string, origin: string, action = false): string {
  if (!isUrl(raw)) throw new Error("Invalid capability endpoint.");
  const url = new URL(raw, origin);
  if (url.origin !== new URL(origin).origin || url.username || url.password || url.hash) throw new Error("Invalid capability endpoint.");
  if (action) {
    if (url.searchParams.has("rest_route")) url.searchParams.set("rest_route", `${url.searchParams.get("rest_route")!.replace(/\/$/, "")}/action`);
    else url.pathname = `${url.pathname.replace(/\/$/, "")}/action`;
  }
  return url.toString();
}
