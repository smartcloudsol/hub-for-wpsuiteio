<?php
/**
 * Site-local custom translation catalog storage and REST handlers.
 */

namespace SmartCloud\WPSuite\Hub;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

if (!defined('ABSPATH')) {
    exit;
}

const WPSUITE_CUSTOM_TRANSLATIONS_OPTION = 'smartcloud-wpsuite/custom-translations-catalog';
const WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION = 'smartcloud-wpsuite/custom-translations-default-locale';
const WPSUITE_CUSTOM_TRANSLATIONS_LOCK = 'smartcloud-wpsuite/custom-translations-lock';
const WPSUITE_CUSTOM_TRANSLATIONS_MAX_BYTES = 1048576;
const WPSUITE_CUSTOM_TRANSLATIONS_MAX_LOCALES = 100;
const WPSUITE_CUSTOM_TRANSLATIONS_MAX_ENTRIES = 20000;
const WPSUITE_CUSTOM_TRANSLATIONS_MAX_KEY_BYTES = 1024;
const WPSUITE_CUSTOM_TRANSLATIONS_MAX_VALUE_BYTES = 65535;

final class CustomTranslationsCatalog
{
    /** @var callable(string): string */
    private $assetUrlProvider;

    /**
     * @param callable(string): string $asset_url_provider
     */
    public function __construct(callable $asset_url_provider)
    {
        $this->assetUrlProvider = $asset_url_provider;
    }

    /**
     * @return array{catalog: array<string, array<string, string>>, defaultLocale: ?string, json: string, revision: string}
     */
    public function getState(): array
    {
        $stored = get_option(WPSUITE_CUSTOM_TRANSLATIONS_OPTION, '{}');
        if (!is_string($stored) || $stored === '') {
            return $this->emptyState();
        }

        try {
            $decoded = json_decode($stored, false, 4, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $this->emptyState();
        }

        if (!$decoded instanceof \stdClass) {
            return $this->emptyState();
        }

        $validated = $this->validateCatalog($decoded);
        if (is_wp_error($validated)) {
            return $this->emptyState();
        }

        return $this->createState(
            $validated,
            $this->resolveDefaultLocale($validated, get_option(WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION, null))
        );
    }

    public function hasTranslations(): bool
    {
        return $this->getState()['catalog'] !== array();
    }

    public function getAssetUrl(): string
    {
        $state = $this->getState();
        return ($this->assetUrlProvider)($state['revision']);
    }

    public function getRestResponse(WP_REST_Request $request): WP_REST_Response
    {
        unset($request); // The signature is shared with WordPress REST callbacks.
        return $this->stateResponse($this->getState());
    }

    public function putRestResponse(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $requested_state = $this->stateFromRequest($request);
        if (is_wp_error($requested_state)) {
            return $requested_state;
        }

        return $this->writeCatalog(
            $requested_state['catalog'],
            $requested_state['defaultLocale'],
            $request,
            false
        );
    }

    public function deleteRestResponse(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        return $this->writeCatalog(array(), null, $request, true);
    }

    public function checkPermission(): bool|WP_Error
    {
        if (!current_user_can('manage_options')) {
            return new WP_Error(
                'rest_forbidden',
                __('You are not allowed to manage WP Suite translations.', 'smartcloud-wpsuite'),
                array('status' => 403)
            );
        }

        return true;
    }

    /**
     * @return array{catalog: array<string, array<string, string>>, defaultLocale: ?string}|WP_Error
     */
    private function stateFromRequest(WP_REST_Request $request): array|WP_Error
    {
        $body = $request->get_body();
        if (!is_string($body) || $body === '') {
            return $this->validationError('The request body must be a JSON object.');
        }
        if (strlen($body) > WPSUITE_CUSTOM_TRANSLATIONS_MAX_BYTES + 16384) {
            return $this->validationError('The translation catalog is too large.', 413);
        }

        try {
            $payload = json_decode($body, false, 5, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $this->validationError('The request body is not valid UTF-8 JSON.');
        }

        if (!$payload instanceof \stdClass) {
            return $this->validationError('The request body must be a JSON object.');
        }

        $properties = array_keys(get_object_vars($payload));
        sort($properties, SORT_STRING);
        $valid_properties = $properties === array('catalog')
            || $properties === array('catalog', 'defaultLocale');
        if (!$valid_properties || !$payload->catalog instanceof \stdClass) {
            return $this->validationError('The request body must contain a catalog and may contain a defaultLocale property.');
        }

        $catalog = $this->validateCatalog($payload->catalog);
        if (is_wp_error($catalog)) {
            return $catalog;
        }

        $has_requested_default = property_exists($payload, 'defaultLocale');
        if ($has_requested_default && $payload->defaultLocale !== null && !is_string($payload->defaultLocale)) {
            return $this->validationError('The default locale must be a locale in the translation catalog.');
        }

        $requested_default = $has_requested_default && is_string($payload->defaultLocale)
            ? trim($payload->defaultLocale)
            : ($has_requested_default
                ? null
                : get_option(WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION, null));
        if ($catalog === array()) {
            if ($requested_default !== null && $requested_default !== '') {
                return $this->validationError('An empty translation catalog cannot have a default locale.');
            }
            return array('catalog' => $catalog, 'defaultLocale' => null);
        }

        $default_locale = $this->matchCatalogLocale($catalog, $requested_default);
        if ($default_locale === null) {
            return $this->validationError('The default locale must be a locale in the translation catalog.');
        }

        return array('catalog' => $catalog, 'defaultLocale' => $default_locale);
    }

    /**
     * @return array<string, array<string, string>>|WP_Error
     */
    private function validateCatalog(\stdClass $input): array|WP_Error
    {
        $locales = get_object_vars($input);
        if (count($locales) > WPSUITE_CUSTOM_TRANSLATIONS_MAX_LOCALES) {
            return $this->validationError('The translation catalog contains too many locales.');
        }

        $catalog = array();
        $normalized_locales = array();
        $entry_count = 0;
        foreach ($locales as $locale => $dictionary) {
            if (!$this->isValidUtf8($locale)
                || strlen($locale) > 35
                || !preg_match('/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/D', $locale)
            ) {
                return $this->validationError('Every translation catalog locale must be a valid locale identifier.');
            }

            $normalized_locale = strtolower(str_replace('_', '-', $locale));
            if (isset($normalized_locales[$normalized_locale])) {
                return $this->validationError('The translation catalog contains duplicate equivalent locales.');
            }
            $normalized_locales[$normalized_locale] = true;

            if (!$dictionary instanceof \stdClass) {
                return $this->validationError('Every locale must map to a translation object.');
            }

            $entries = get_object_vars($dictionary);
            $entry_count += count($entries);
            if ($entry_count > WPSUITE_CUSTOM_TRANSLATIONS_MAX_ENTRIES) {
                return $this->validationError('The translation catalog contains too many entries.');
            }

            $validated_entries = array();
            foreach ($entries as $source => $translation) {
                if ($source === ''
                    || strlen($source) > WPSUITE_CUSTOM_TRANSLATIONS_MAX_KEY_BYTES
                    || !$this->isValidUtf8($source)
                    || str_contains($source, "\0")
                ) {
                    return $this->validationError('Every translation key must be a non-empty UTF-8 string of an allowed length.');
                }
                if (!is_string($translation)
                    || strlen($translation) > WPSUITE_CUSTOM_TRANSLATIONS_MAX_VALUE_BYTES
                    || !$this->isValidUtf8($translation)
                    || str_contains($translation, "\0")
                ) {
                    return $this->validationError('Every translation value must be a UTF-8 string of an allowed length.');
                }
                $validated_entries[$source] = $translation;
            }

            ksort($validated_entries, SORT_STRING);
            $catalog[$locale] = $validated_entries;
        }

        ksort($catalog, SORT_STRING);
        $json = $this->encodeCatalog($catalog);
        if (is_wp_error($json)) {
            return $json;
        }
        if (strlen($json) > WPSUITE_CUSTOM_TRANSLATIONS_MAX_BYTES) {
            return $this->validationError('The translation catalog is too large.', 413);
        }

        return $catalog;
    }

    /**
     * @param array<string, array<string, string>> $catalog
     */
    private function writeCatalog(
        array $catalog,
        ?string $default_locale,
        WP_REST_Request $request,
        bool $delete
    ): WP_REST_Response|WP_Error
    {
        $if_match = trim((string) $request->get_header('If-Match'));
        if ($if_match === '') {
            return new WP_Error(
                'wpsuite_translations_precondition_required',
                __('An If-Match revision is required.', 'smartcloud-wpsuite'),
                array('status' => 428)
            );
        }

        $lock_token = $this->acquireLock();
        if (is_wp_error($lock_token)) {
            return $lock_token;
        }

        try {
            $current = $this->getState();
            if (!$this->matchesRevision($if_match, $current['revision'])) {
                return new WP_Error(
                    'wpsuite_translations_revision_conflict',
                    __('The translation catalog changed after it was loaded.', 'smartcloud-wpsuite'),
                    array(
                        'status' => 412,
                        'revision' => $current['revision'],
                        'assetUrl' => ($this->assetUrlProvider)($current['revision']),
                    )
                );
            }

            $next = $this->createState($catalog, $default_locale);
            $changed = !hash_equals($current['revision'], $next['revision']);
            if ($delete || $catalog === array()) {
                delete_option(WPSUITE_CUSTOM_TRANSLATIONS_OPTION);
                delete_option(WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION);
            } else {
                if ($current['json'] !== $next['json']) {
                    update_option(WPSUITE_CUSTOM_TRANSLATIONS_OPTION, $next['json'], false);
                }
                $stored_default = get_option(WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION, null);
                if (!is_string($stored_default) || $stored_default !== $next['defaultLocale']) {
                    update_option(
                        WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION,
                        $next['defaultLocale'],
                        false
                    );
                }
            }

            return $this->stateResponse($next, $changed);
        } finally {
            $this->releaseLock($lock_token);
        }
    }

    private function acquireLock(): string|WP_Error
    {
        try {
            $token = bin2hex(random_bytes(16));
        } catch (\Throwable) {
            $token = uniqid('wpsuite-', true);
        }

        $lock = array('token' => $token, 'expires' => time() + 30);
        if (add_option(WPSUITE_CUSTOM_TRANSLATIONS_LOCK, $lock, '', false)) {
            return $token;
        }

        $existing = get_option(WPSUITE_CUSTOM_TRANSLATIONS_LOCK, null);
        if (is_array($existing) && (int) ($existing['expires'] ?? 0) < time()) {
            delete_option(WPSUITE_CUSTOM_TRANSLATIONS_LOCK);
            if (add_option(WPSUITE_CUSTOM_TRANSLATIONS_LOCK, $lock, '', false)) {
                return $token;
            }
        }

        return new WP_Error(
            'wpsuite_translations_locked',
            __('The translation catalog is being saved by another request.', 'smartcloud-wpsuite'),
            array('status' => 409)
        );
    }

    private function releaseLock(string $token): void
    {
        $lock = get_option(WPSUITE_CUSTOM_TRANSLATIONS_LOCK, null);
        if (is_array($lock) && hash_equals($token, (string) ($lock['token'] ?? ''))) {
            delete_option(WPSUITE_CUSTOM_TRANSLATIONS_LOCK);
        }
    }

    private function matchesRevision(string $if_match, string $revision): bool
    {
        foreach (explode(',', $if_match) as $candidate) {
            $candidate = trim($candidate);
            if (str_starts_with($candidate, 'W/')) {
                // If-Match uses strong comparison. A weak validator must never
                // authorize a write, even if its opaque tag happens to match.
                continue;
            }
            $candidate = trim($candidate, "\"'");
            if ($candidate !== '' && hash_equals($revision, $candidate)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string, array<string, string>> $catalog
     * @return array{catalog: array<string, array<string, string>>, defaultLocale: ?string, json: string, revision: string}
     */
    private function createState(array $catalog, ?string $default_locale = null): array
    {
        $json = $this->encodeCatalog($catalog);
        if (is_wp_error($json)) {
            $json = '{}';
            $catalog = array();
        }

        $default_locale = $this->resolveDefaultLocale($catalog, $default_locale);
        $revision_payload = wp_json_encode(
            array(
                'catalog' => $this->catalogObject($catalog),
                'defaultLocale' => $default_locale,
            ),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        );
        if (!is_string($revision_payload)) {
            $revision_payload = '{"catalog":{},"defaultLocale":null}';
        }

        return array(
            'catalog' => $catalog,
            'defaultLocale' => $default_locale,
            'json' => $json,
            'revision' => hash('sha256', $revision_payload),
        );
    }

    /**
     * @return array{catalog: array<string, array<string, string>>, defaultLocale: ?string, json: string, revision: string}
     */
    private function emptyState(): array
    {
        return $this->createState(array(), null);
    }

    /**
     * @param array<string, array<string, string>> $catalog
     */
    private function resolveDefaultLocale(array $catalog, mixed $preferred): ?string
    {
        if ($catalog === array()) {
            return null;
        }

        $matched = $this->matchCatalogLocale($catalog, $preferred);
        if ($matched !== null) {
            return $matched;
        }

        foreach (array_keys($catalog) as $locale) {
            if ($this->normalizeLocale($locale) === 'en') {
                return $locale;
            }
        }
        foreach (array_keys($catalog) as $locale) {
            if (str_starts_with($this->normalizeLocale($locale), 'en-')) {
                return $locale;
            }
        }

        return array_key_first($catalog);
    }

    /**
     * @param array<string, array<string, string>> $catalog
     */
    private function matchCatalogLocale(array $catalog, mixed $candidate): ?string
    {
        if (!is_string($candidate) || trim($candidate) === '') {
            return null;
        }
        $normalized = $this->normalizeLocale($candidate);
        foreach (array_keys($catalog) as $locale) {
            if ($this->normalizeLocale($locale) === $normalized) {
                return $locale;
            }
        }
        return null;
    }

    private function normalizeLocale(string $locale): string
    {
        return strtolower(str_replace('_', '-', trim($locale)));
    }

    /**
     * @param array<string, array<string, string>> $catalog
     */
    private function encodeCatalog(array $catalog): string|WP_Error
    {
        $encoded = wp_json_encode(
            $this->catalogObject($catalog),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        );
        if (!is_string($encoded)) {
            return $this->validationError('The translation catalog could not be encoded.');
        }

        return $encoded;
    }

    /**
     * Preserve JSON object semantics for empty catalogs and empty locale dictionaries.
     *
     * @param array<string, array<string, string>> $catalog
     */
    private function catalogObject(array $catalog): \stdClass
    {
        $result = new \stdClass();
        foreach ($catalog as $locale => $entries) {
            $dictionary = new \stdClass();
            foreach ($entries as $source => $translation) {
                $dictionary->{$source} = $translation;
            }
            $result->{$locale} = $dictionary;
        }
        return $result;
    }

    /**
     * @param array{catalog: array<string, array<string, string>>, defaultLocale: ?string, json: string, revision: string} $state
     */
    private function stateResponse(array $state, bool $changed = false): WP_REST_Response
    {
        $response = new WP_REST_Response(
            array(
                'catalog' => $this->catalogObject($state['catalog']),
                'defaultLocale' => $state['defaultLocale'],
                'revision' => $state['revision'],
                'assetUrl' => ($this->assetUrlProvider)($state['revision']),
                'changed' => $changed,
            ),
            200
        );
        $response->header('ETag', '"' . $state['revision'] . '"');
        return $response;
    }

    private function isValidUtf8(string $value): bool
    {
        return preg_match('//u', $value) === 1;
    }

    private function validationError(string $message, int $status = 400): WP_Error
    {
        return new WP_Error(
            'wpsuite_translations_invalid_catalog',
            __($message, 'smartcloud-wpsuite'),
            array('status' => $status)
        );
    }
}
