import assert from "node:assert/strict";
import test from "node:test";

import {
  applyImport,
  canonicalizeCatalogLocale,
  chooseDefaultLocale,
  prepareImport,
  queryCatalogKeys,
  summarizeImport,
  validateCatalog,
  type TranslationCatalog,
} from "./catalog.ts";

test("initialize replaces the catalog exactly", () => {
  const current = { en: { Old: "Old" } };
  const imported = { hu: { Hello: "Szia", Empty: "" } };
  assert.deepEqual(applyImport(current, imported, "initialize"), imported);
});

test("merge-skip adds missing entries and preserves conflicts", () => {
  const current = { hu: { Hello: "Szia", Empty: "" } };
  const imported = { hu: { Hello: "Helló", Empty: "", New: "Új" }, de: { New: "Neu" } };
  assert.deepEqual(applyImport(current, imported, "merge-skip"), {
    hu: { Hello: "Szia", Empty: "", New: "Új" },
    de: { New: "Neu" },
  });
});

test("merge-overwrite replaces conflicts and preserves explicit empty values", () => {
  const current = { hu: { Hello: "Szia", Empty: "" } };
  const imported = { hu: { Hello: "Helló", Empty: "", New: "" } };
  assert.deepEqual(applyImport(current, imported, "merge-overwrite"), imported);
});

test("summary distinguishes conflicts, identical values, additions, overwrites, and skips", () => {
  const current = { hu: { Hello: "Szia", Empty: "" } };
  const imported = { hu: { Hello: "Helló", Empty: "", New: "" } };
  assert.deepEqual(summarizeImport(current, imported, "merge-skip"), {
    additions: 1,
    conflicts: 1,
    overwrites: 0,
    skips: 1,
    unchanged: 1,
  });
  assert.deepEqual(summarizeImport(current, imported, "merge-overwrite"), {
    additions: 1,
    conflicts: 1,
    overwrites: 1,
    skips: 0,
    unchanged: 1,
  });
});

test("validation rejects equivalent locale duplicates and invalid locale syntax", () => {
  assert.equal(validateCatalog({ en_US: {}, "EN-us": {} }).valid, false);
  assert.equal(validateCatalog({ english: {} }).valid, false);
  assert.equal(validateCatalog({ "en-US\n": {} }).valid, false);
});

test("locale display canonicalization preserves a cultured locale name", () => {
  assert.equal(canonicalizeCatalogLocale("hu_hu"), "hu-HU");
  assert.equal(canonicalizeCatalogLocale("aa_X000"), "aa-X000");
});

test("default locale resolution preserves a valid choice and otherwise prefers English", () => {
  const catalog = { de_DE: {}, "en-US": {}, "fr-FR": {} };
  assert.equal(chooseDefaultLocale(catalog, "DE-de"), "de_DE");
  assert.equal(chooseDefaultLocale(catalog, "hu-HU"), "en-US");
  assert.equal(chooseDefaultLocale({ fr: {}, de: {} }, null), "de");
  assert.equal(chooseDefaultLocale({}, "en-US"), null);
});

test("catalog queries search values, scope missing rows, and sort missing values last", () => {
  const catalog = {
    "en-US": { Alpha: "Alpha", Beta: "Second", Gamma: "Third" },
    "hu-HU": { Alpha: "Alfa", Gamma: "Harmadik" },
  };

  assert.deepEqual(queryCatalogKeys(catalog, { search: "harm" }), ["Gamma"]);
  assert.deepEqual(
    queryCatalogKeys(catalog, { search: "second", locale: "hu-HU" }),
    [],
  );
  assert.deepEqual(
    queryCatalogKeys(catalog, { missingOnly: true, locale: "hu-HU" }),
    ["Beta"],
  );
  assert.deepEqual(
    queryCatalogKeys(catalog, {
      sortBy: "hu-HU",
      sortDirection: "desc",
    }),
    ["Gamma", "Alpha", "Beta"],
  );
});

test("validation enforces locale and entry count limits", () => {
  const locales = Object.fromEntries(
    Array.from({ length: 101 }, (_, index) => [`aa-X${String(index).padStart(3, "0")}`, {}]),
  );
  assert.equal(validateCatalog(locales).valid, false);

  const entries = Object.fromEntries(
    Array.from({ length: 20_001 }, (_, index) => [`key-${index}`, "value"]),
  );
  assert.equal(validateCatalog({ en: entries }).valid, false);
});

test("validation applies UTF-8 byte, null-byte, and canonical JSON size limits", () => {
  assert.equal(validateCatalog({ en: { ["é".repeat(513)]: "value" } }).valid, false);
  assert.equal(validateCatalog({ en: { key: "é".repeat(32_768) } }).valid, false);
  assert.equal(validateCatalog({ en: { "bad\0key": "value" } }).valid, false);
  assert.equal(validateCatalog({ en: { key: "bad\0value" } }).valid, false);

  const overOneMiB: TranslationCatalog = {
    en: Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`key-${index}`, "a".repeat(65_535)]),
    ),
  };
  assert.equal(validateCatalog(overOneMiB).valid, false);
});

test("a merge is rejected before mutation when the combined catalog exceeds a limit", () => {
  const current = {
    en: Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [`current-${index}`, "value"]),
    ),
  };
  const imported = {
    en: Object.fromEntries(
      Array.from({ length: 10_001 }, (_, index) => [`imported-${index}`, "value"]),
    ),
  };
  const prepared = prepareImport(current, imported, "merge-skip");
  assert.equal(prepared.valid, false);
  assert.equal(Object.keys(current.en).length, 10_000);
});

test("validation accepts limits and preserves explicit empty strings", () => {
  const dictionary = JSON.parse('{"key":"","__proto__":"safe"}') as Record<string, string>;
  dictionary["é".repeat(512)] = "é".repeat(32_767);
  const result = validateCatalog({ en_US: dictionary });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.catalog.en_US.key, "");
    assert.equal(result.catalog.en_US.__proto__, "safe");
  }
});
