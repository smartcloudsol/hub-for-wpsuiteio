export type TranslationCatalog = Record<string, Record<string, string>>;

export type ImportMode = "initialize" | "merge-skip" | "merge-overwrite";

export type ImportSummary = {
  additions: number;
  conflicts: number;
  overwrites: number;
  skips: number;
  unchanged: number;
};

export type CatalogQuery = {
  search?: string;
  locale?: string | null;
  missingOnly?: boolean;
  sortBy?: "key" | string;
  sortDirection?: "asc" | "desc";
};

export type CatalogValidation =
  | { valid: true; catalog: TranslationCatalog }
  | { valid: false; error: string };

const inheritedLocales = new Set([
  "",
  "auto",
  "browser",
  "default",
  "inherit",
  "site",
  "system",
]);

const MAX_CATALOG_BYTES = 1_048_576;
const MAX_LOCALES = 100;
const MAX_ENTRIES = 20_000;
const MAX_KEY_BYTES = 1_024;
const MAX_VALUE_BYTES = 65_535;
const MAX_LOCALE_LENGTH = 35;
const localePattern = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*(?![\s\S])/;
const encoder = new TextEncoder();

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function canonicalJsonBytes(catalog: TranslationCatalog): number {
  // PHP's json_encode() keeps these two separators escaped unless
  // JSON_UNESCAPED_LINE_TERMINATORS is explicitly enabled.
  const json = JSON.stringify(catalog)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return utf8Bytes(json);
}

function bytewiseCompare(left: string, right: string): number {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] - rightBytes[index];
    }
  }
  return leftBytes.length - rightBytes.length;
}

export function normalizeCatalogLocale(locale: string): string | undefined {
  if (
    locale.length > MAX_LOCALE_LENGTH
    || !localePattern.test(locale)
    || inheritedLocales.has(locale.toLowerCase())
  ) return undefined;
  return locale.toLowerCase().replaceAll("_", "-");
}

export function canonicalizeCatalogLocale(locale: string): string | undefined {
  if (!normalizeCatalogLocale(locale)) return undefined;
  const hyphenated = locale.replaceAll("_", "-");
  try {
    return Intl.getCanonicalLocales(hyphenated)[0];
  } catch {
    return hyphenated;
  }
}

export function validateCatalog(input: unknown): CatalogValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: "The JSON root must be an object." };
  }

  const localeEntries = Object.entries(input);
  if (localeEntries.length > MAX_LOCALES) {
    return { valid: false, error: "The translation catalog contains more than 100 locales." };
  }

  const catalog: TranslationCatalog = {};
  const normalizedLocales = new Set<string>();
  let entryCount = 0;
  for (const [locale, values] of localeEntries) {
    const normalizedLocale = normalizeCatalogLocale(locale);
    if (!normalizedLocale) {
      return {
        valid: false,
        error: `“${locale}” is not a valid locale code.`,
      };
    }
    if (normalizedLocales.has(normalizedLocale)) {
      return {
        valid: false,
        error: `Locale “${locale}” duplicates another locale in the catalog.`,
      };
    }
    normalizedLocales.add(normalizedLocale);
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      return {
        valid: false,
        error: `Locale “${locale}” must contain an object of key/value pairs.`,
      };
    }

    const validatedEntries: Array<[string, string]> = [];
    const entries = Object.entries(values);
    entryCount += entries.length;
    if (entryCount > MAX_ENTRIES) {
      return { valid: false, error: "The translation catalog contains more than 20,000 entries." };
    }
    for (const [key, value] of entries) {
      if (
        key === ""
        || key.includes("\0")
        || !isUnicodeScalarString(key)
        || utf8Bytes(key) > MAX_KEY_BYTES
      ) {
        return {
          valid: false,
          error: `A translation key in “${locale}” is empty, invalid, or longer than 1,024 UTF-8 bytes.`,
        };
      }
      if (
        typeof value !== "string"
        || value.includes("\0")
        || !isUnicodeScalarString(value)
        || utf8Bytes(value) > MAX_VALUE_BYTES
      ) {
        return {
          valid: false,
          error: `The value for “${key}” in “${locale}” must be a valid string no longer than 65,535 UTF-8 bytes.`,
        };
      }
      validatedEntries.push([key, value]);
    }
    catalog[locale] = Object.fromEntries(
      validatedEntries.sort(([left], [right]) => bytewiseCompare(left, right)),
    );
  }

  const canonical = Object.fromEntries(
    Object.entries(catalog).sort(([left], [right]) => bytewiseCompare(left, right)),
  );
  if (canonicalJsonBytes(canonical) > MAX_CATALOG_BYTES) {
    return { valid: false, error: "The canonical translation catalog is larger than 1 MiB." };
  }

  return { valid: true, catalog: canonical };
}

export function cloneCatalog(catalog: TranslationCatalog): TranslationCatalog {
  return Object.fromEntries(
    Object.entries(catalog).map(([locale, dictionary]) => [
      locale,
      { ...dictionary },
    ]),
  );
}

/** Resolve a preferred locale to its catalog key, then choose a stable default. */
export function chooseDefaultLocale(
  catalog: TranslationCatalog,
  preferred?: string | null,
): string | null {
  const locales = Object.keys(catalog).sort(bytewiseCompare);
  if (locales.length === 0) return null;

  const normalizedPreferred = preferred
    ? normalizeCatalogLocale(preferred)
    : undefined;
  if (normalizedPreferred) {
    const match = locales.find(
      (locale) => normalizeCatalogLocale(locale) === normalizedPreferred,
    );
    if (match) return match;
  }

  return locales.find((locale) => normalizeCatalogLocale(locale) === "en")
    ?? locales.find((locale) => normalizeCatalogLocale(locale)?.startsWith("en-"))
    ?? locales[0];
}

function sortedCatalog(catalog: TranslationCatalog): TranslationCatalog {
  return Object.fromEntries(
    Object.keys(catalog)
      .sort()
      .map((locale) => [
        locale,
        Object.fromEntries(
          Object.keys(catalog[locale])
            .sort()
            .map((key) => [key, catalog[locale][key]]),
        ),
      ]),
  );
}

export function catalogsEqual(
  left: TranslationCatalog,
  right: TranslationCatalog,
): boolean {
  return JSON.stringify(sortedCatalog(left)) === JSON.stringify(sortedCatalog(right));
}

export function isCatalogEmpty(catalog: TranslationCatalog): boolean {
  return Object.values(catalog).every(
    (dictionary) => Object.keys(dictionary).length === 0,
  );
}

export function getCatalogKeys(catalog: TranslationCatalog): string[] {
  return Array.from(
    new Set(Object.values(catalog).flatMap((dictionary) => Object.keys(dictionary))),
  ).sort((left, right) => left.localeCompare(right));
}

/** Filter and sort catalog rows without coupling the behavior to the editor UI. */
export function queryCatalogKeys(
  catalog: TranslationCatalog,
  query: CatalogQuery = {},
): string[] {
  const locales = Object.keys(catalog);
  const selectedLocale = query.locale && Object.prototype.hasOwnProperty.call(catalog, query.locale)
    ? query.locale
    : null;
  const searchedLocales = selectedLocale ? [selectedLocale] : locales;
  const needle = query.search?.trim().toLocaleLowerCase() ?? "";
  const sortBy = query.sortBy && query.sortBy !== "key" && locales.includes(query.sortBy)
    ? query.sortBy
    : "key";
  const direction = query.sortDirection === "desc" ? -1 : 1;

  return getCatalogKeys(catalog)
    .filter((key) => {
      if (query.missingOnly) {
        const missing = searchedLocales.some(
          (locale) => !Object.prototype.hasOwnProperty.call(catalog[locale], key),
        );
        if (!missing) return false;
      }

      if (!needle) return true;
      if (key.toLocaleLowerCase().includes(needle)) return true;
      return searchedLocales.some((locale) => {
        const value = catalog[locale][key];
        return typeof value === "string" && value.toLocaleLowerCase().includes(needle);
      });
    })
    .sort((left, right) => {
      if (sortBy === "key") {
        return direction * left.localeCompare(right);
      }

      const leftExists = Object.prototype.hasOwnProperty.call(catalog[sortBy], left);
      const rightExists = Object.prototype.hasOwnProperty.call(catalog[sortBy], right);
      if (leftExists !== rightExists) return leftExists ? -1 : 1;

      const byValue = (catalog[sortBy][left] ?? "").localeCompare(
        catalog[sortBy][right] ?? "",
      );
      return byValue === 0
        ? left.localeCompare(right)
        : direction * byValue;
    });
}

export function summarizeImport(
  current: TranslationCatalog,
  imported: TranslationCatalog,
  mode: ImportMode,
): ImportSummary {
  const summary: ImportSummary = {
    additions: 0,
    conflicts: 0,
    overwrites: 0,
    skips: 0,
    unchanged: 0,
  };

  for (const [locale, dictionary] of Object.entries(imported)) {
    const existing = current[locale];
    for (const [key, value] of Object.entries(dictionary)) {
      if (!existing || !Object.prototype.hasOwnProperty.call(existing, key)) {
        summary.additions += 1;
      } else if (existing[key] === value) {
        summary.unchanged += 1;
      } else {
        summary.conflicts += 1;
        if (mode === "merge-overwrite") summary.overwrites += 1;
        if (mode === "merge-skip") summary.skips += 1;
      }
    }
  }

  return summary;
}

export function applyImport(
  current: TranslationCatalog,
  imported: TranslationCatalog,
  mode: ImportMode,
): TranslationCatalog {
  if (mode === "initialize") return cloneCatalog(imported);

  const merged = cloneCatalog(current);
  for (const [locale, dictionary] of Object.entries(imported)) {
    merged[locale] ??= {};
    for (const [key, value] of Object.entries(dictionary)) {
      const exists = Object.prototype.hasOwnProperty.call(merged[locale], key);
      if (!exists || mode === "merge-overwrite") {
        Object.defineProperty(merged[locale], key, {
          configurable: true,
          enumerable: true,
          value,
          writable: true,
        });
      }
    }
  }
  return merged;
}

export function prepareImport(
  current: TranslationCatalog,
  imported: TranslationCatalog,
  mode: ImportMode,
): CatalogValidation {
  return validateCatalog(applyImport(current, imported, mode));
}
