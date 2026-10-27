<?php
namespace SmartCloud\WPSuite\Hub;

if (!defined('ABSPATH')) { exit; }

/** Site-wide backend selection; shared WordPress content is deliberately not copied. */
final class BackendProfiles
{
    public const OPTION = 'smartcloud-wpsuite/backend-profiles-v1';
    private static bool $booted = false;
    private static ?array $override = null;
    private static ?array $pending = null;
    private static $validator = null;
    private static ?array $requestContext = null;
    private static bool $requestLease = false;

    public static function eligible(): bool
    {
        return function_exists('home_url') && function_exists('site_url')
            && rtrim(home_url(), '/') === 'https://dev.wpsuite.io'
            && rtrim(site_url(), '/') === 'https://dev.wpsuite.io';
    }

    public static function boot(): void
    {
        if (self::$booted || !self::eligible()) return;
        self::$booted = true;
        $registry = self::registry();
        if ($registry) self::$requestContext = ['id' => $registry['active'], 'generation' => $registry['generation']];
        self::readRenderContext();
        add_filter('smartcloud_wpsuite_backend_profile_context', static fn() => self::captureContext());
        add_filter('smartcloud_wpsuite_backend_profile_option_name', static fn($name) => self::optionName($name));
        add_filter('smartcloud_wpsuite_backend_profile_contexts', static fn() => self::configuredContexts());
        add_filter('smartcloud_wpsuite_backend_profile_identity_config', static fn() => self::identityConfiguration());
        add_filter('smartcloud_wpsuite_site_settings', static fn($raw) => self::settings() ?? $raw);
        add_filter('smartcloud_wpsuite_virtual_asset_base_url', static fn($url) => self::assetBaseUrl() ?? $url);
        foreach (['smartcloud-wpsuite/site-settings', 'hub-for-wpsuiteio/site-settings'] as $name) {
            add_filter('pre_option_' . $name, static fn($pre) => self::settings() ?? $pre);
        }
        foreach (['license-jws' => 'jws', 'config-encrypted' => 'config', 'license-last-refresh' => 'refreshedAt', 'license-binding' => 'binding'] as $suffix => $field) {
            foreach (['', 'wpsuite-profile/production/', 'wpsuite-profile/development/'] as $prefix) {
                add_filter('pre_option_' . $prefix . 'smartcloud-wpsuiteio/' . $suffix, static function ($pre) use ($prefix, $field) {
                    $registry = self::registry();
                    if (!$registry) return $pre;
                    $id = $prefix === '' ? self::record($registry)['id'] : (str_contains($prefix, '/production/') ? 'production' : 'development');
                    return $registry['profiles'][$id]['assets'][$field] ?? ($field === 'refreshedAt' ? 0 : '');
                });
            }
        }
        add_filter('rest_pre_dispatch', [self::class, 'guardRequest'], 1, 3);
        add_action('rest_api_init', [self::class, 'registerRoutes']);
        // Profile state, signatures and backend-specific globals must never enter a shared page cache.
        if (self::captureContext() !== null) {
            if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
            add_action('send_headers', static function (): void { nocache_headers(); });
        }
    }

    public static function setValidator(callable $validator): void { self::$validator = $validator; }

    private static function registry(): ?array
    {
        if (!self::eligible()) return null;
        $value = get_option(self::OPTION, null);
        if ($value === null) return null;
        if (!is_array($value) || ($value['schemaVersion'] ?? null) !== 1
            || !in_array($value['active'] ?? null, ['production', 'development'], true)
            || !is_int($value['generation'] ?? null) || $value['generation'] < 1
            || !is_int($value['storageRevision'] ?? null) || $value['storageRevision'] < 1
            || !in_array($value['legacyStateOwner'] ?? null, ['production', 'development'], true)
            || !isset($value['profiles'][$value['active']]['connection'])) throw new \RuntimeException('The saved backend profile registry is invalid. Restore its configuration before using backend services.');
        if (!isset($value['profiles'][$value['legacyStateOwner']]) || array_diff(array_keys($value['profiles']), ['production', 'development'])) throw new \RuntimeException('Invalid backend profile ownership.');
        foreach ($value['profiles'] as $id => $record) {
            $connection = $record['connection'] ?? null;
            $fields = is_object($connection) ? get_object_vars($connection) : $connection;
            if (!is_array($record) || ($record['id'] ?? null) !== $id || !is_int($record['bindingRevision'] ?? null) || $record['bindingRevision'] < 1
                || !is_array($fields) || !SiteKeyStorage::isSealed($fields['siteKey'] ?? null)
                || ($record['legacyApiBaseUrl'] ?? null) !== ($id === 'production' ? 'https://api.wpsuite.io' : 'https://api-dev.wpsuite.io')
                || !is_string($record['legacyConfigUrl'] ?? null) || !preg_match('~^https://wpsuite\.io/static/config/[A-Za-z0-9/_\-.]+\.json$~D', $record['legacyConfigUrl'])
                || str_contains($record['legacyConfigUrl'], '..')) throw new \RuntimeException('Invalid saved backend profile binding.');
            self::validateIdentityTuple($record['identity'] ?? null, $id);
        }
        return $value;
    }

    public static function enabled(): bool { return self::registry() !== null; }

    private static function record(?array $registry = null): ?array
    {
        if (self::$pending !== null) return self::$pending;
        $registry = $registry ?? self::registry();
        if (!$registry) return null;
        $id = self::$override['id'] ?? self::$requestContext['id'] ?? $registry['active'];
        $record = $registry['profiles'][$id] ?? null;
        if (!is_array($record)) return null;
        return ['id' => $id] + $record;
    }

    public static function captureContext(): ?array
    {
        $registry = self::registry();
        $record = self::record($registry);
        if (!$registry || !$record) return null;
        return ['enabled' => true, 'id' => $record['id'], 'generation' => self::$requestContext['generation'] ?? $registry['generation'],
            'bindingRevision' => $record['bindingRevision'], 'legacyStateOwner' => $registry['legacyStateOwner'],
            'namespace' => $record['id'] === $registry['legacyStateOwner'] ? '' : $record['id'],
            'cmsOrigin' => 'https://dev.wpsuite.io',
            'identity' => $record['identity'],
            'legacyApiBaseUrl' => $record['legacyApiBaseUrl'], 'legacyConfigUrl' => $record['legacyConfigUrl']];
    }

    public static function legacyContext(): ?array
    {
        $registry = self::registry();
        if (!$registry) return null;
        $id = $registry['legacyStateOwner'];
        return ['id' => $id, 'bindingRevision' => $registry['legacyBindingRevision'] ?? 1];
    }

    public static function configuredContexts(): array
    {
        $registry = self::registry();
        if (!$registry) return [];
        return array_map(static fn($record) => ['id' => $record['id'], 'bindingRevision' => $record['bindingRevision'],
            'namespace' => $record['id'] === $registry['legacyStateOwner'] ? '' : $record['id']], array_values($registry['profiles']));
    }

    public static function identityConfiguration(): ?array
    {
        return self::record()['identity'] ?? null;
    }

    public static function runWithContext(?array $context, callable $callback): mixed
    {
        if ($context === null) {
            if (self::enabled()) throw new \RuntimeException('A backend profile is required for this operation.');
            return $callback();
        }
        $registry = self::registry();
        $id = $context['id'] ?? null;
        if (!$registry || !in_array($id, ['production', 'development'], true)
            || !is_int($context['bindingRevision'] ?? null)
            || ($registry['profiles'][$id]['bindingRevision'] ?? null) !== $context['bindingRevision']) {
            throw new \RuntimeException('The captured backend profile is no longer available.');
        }
        $previous = self::$override;
        self::$override = ['id' => $id, 'bindingRevision' => $context['bindingRevision']];
        try { return $callback(); } finally { self::$override = $previous; }
    }

    public static function optionName(string $name): string
    {
        $context = self::captureContext();
        return $context && $context['namespace'] !== '' ? 'wpsuite-profile/' . $context['id'] . '/' . $name : $name;
    }

    public static function settings(): ?SiteSettings
    {
        $record = self::record();
        if (!$record || !self::eligible()) return null;
        $raw = $record['connection'] ?? null;
        if (!is_array($raw) && !is_object($raw)) throw new \RuntimeException('Invalid backend profile connection.');
        $runtime = SiteKeyStorage::read($raw, 'backend-profile:' . $record['id']);
        $settings = SiteSettings::fromArray(is_object($runtime) ? get_object_vars($runtime) : $runtime);
        if (!SiteSettings::usableSiteKey($settings->siteKey)) throw new \RuntimeException('The backend profile connection is locked.');
        return $settings;
    }

    public static function legacyApiBase(string $fallback): string
    {
        return self::record()['legacyApiBaseUrl'] ?? $fallback;
    }

    public static function assetBaseUrl(): ?string
    {
        $context = self::captureContext();
        return $context ? home_url('/smartcloud-wpsuiteio/profile/' . $context['id'] . '/' . $context['bindingRevision'] . '/') : null;
    }

    /** No connection key, ciphertext or complete settings is ever returned to the selector. */
    public static function status(): array
    {
        $registry = self::registry();
        $profiles = [];
        foreach (['production', 'development'] as $id) {
            $record = $registry['profiles'][$id] ?? null;
            $profiles[] = ['id' => $id, 'configured' => is_array($record), 'valid' => is_array($record),
                'bindingRevision' => $record['bindingRevision'] ?? null];
        }
        $status = ['enabled' => $registry !== null, 'active' => $registry['active'] ?? 'production',
            'generation' => $registry['generation'] ?? 0, 'profiles' => $profiles];
        $settings = self::settings();
        if (!$settings) {
            $raw = get_option('smartcloud-wpsuite/site-settings', null) ?? get_option('hub-for-wpsuiteio/site-settings', null);
            if (is_object($raw) || is_array($raw)) $settings = SiteSettings::fromArray(is_object($raw) ? get_object_vars($raw) : $raw);
        }
        if ($settings) {
            $status['currentConnection'] = [];
            foreach (['workspaceId', 'accountId', 'siteId', 'subscriber', 'workspaceApiMode', 'platformApiBaseUrl', 'platformConfigUrl'] as $field) $status['currentConnection'][$field] = $settings->$field;
        }
        return $status;
    }

    public static function registerRoutes(): void
    {
        if (!self::eligible()) return;
        register_rest_route('smartcloud-wpsuite/v1', '/backend-profiles', [
            'methods' => 'GET', 'permission_callback' => [self::class, 'permission'],
            'callback' => static fn() => new \WP_REST_Response(self::status(), 200, ['Cache-Control' => 'no-store'])]);
        register_rest_route('smartcloud-wpsuite/v1', '/backend-profile-context', [
            'methods' => 'GET', 'permission_callback' => static fn() => self::eligible(),
            'callback' => static function () {
                $context = self::captureContext();
                return new \WP_REST_Response(['enabled' => $context !== null, 'active' => $context['id'] ?? 'production',
                    'generation' => $context['generation'] ?? 0, 'bindingRevision' => $context['bindingRevision'] ?? 0], 200, ['Cache-Control' => 'no-store']);
            }]);
        foreach (['configure', 'activate'] as $action) {
            register_rest_route('smartcloud-wpsuite/v1', '/backend-profiles/' . $action, [
                'methods' => 'POST', 'permission_callback' => [self::class, 'permission'],
                'callback' => static function ($request) use ($action) {
                    try { return new \WP_REST_Response(self::$action($request->get_json_params() ?? []), 200, ['Cache-Control' => 'no-store']); }
                    catch (\Throwable $error) { return self::failure($error); }
                }]);
        }
    }

    public static function permission($request): bool|\WP_Error
    {
        if (!self::eligible() || !current_user_can('manage_options')) return new \WP_Error('backend_profile_forbidden', 'Backend profile access is unavailable.', ['status' => 403]);
        if (!wp_verify_nonce($request->get_header('X-WP-Nonce'), 'wp_rest')) return new \WP_Error('backend_profile_nonce', 'Reload this page before changing the backend profile.', ['status' => 403]);
        return true;
    }

    public static function guardRequest($result, $server, $request): mixed
    {
        if (!self::enabled() || in_array($request->get_method(), ['GET', 'HEAD', 'OPTIONS'], true)) return $result;
        $route = $request->get_route();
        if (str_starts_with($route, '/smartcloud-wpsuite/v1/backend-profiles/')) return $result;
        if (!preg_match('~^/(?:wp/v2|smartcloud|gatey|hub-for-wpsuiteio)~', $route)) return $result;
        // Hold the same DB lease used by activation until this mutation finishes.
        // A switch cannot retarget a save between its REST guard and its later hooks.
        global $wpdb;
        $lock = 'wpsuite-profiles-' . substr(hash('sha256', $wpdb->options), 0, 36);
        if (!self::$requestLease) {
            if ((string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s,0)', $lock)) !== '1') return new \WP_Error('backend_profile_busy', 'Another backend operation is running. Retry shortly.', ['status' => 409]);
            self::$requestLease = true;
            register_shutdown_function(static function () use ($wpdb, $lock): void { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); });
        }
        wp_cache_delete(self::OPTION, 'options'); wp_cache_delete('alloptions', 'options');
        $current = self::registry();
        $context = self::captureContext();
        if (self::$override !== null && self::publisherCallback($route)) return $result;
        if (self::$override !== null || ($current['active'] ?? null) !== $context['id'] || ($current['generation'] ?? null) !== $context['generation']
            || $request->get_header('X-WPSuite-Backend-Profile') !== $context['id']
            || (string) $request->get_header('X-WPSuite-Backend-Generation') !== (string) $context['generation']
            || (string) $request->get_header('X-WPSuite-Backend-Binding-Revision') !== (string) $context['bindingRevision']) {
            return new \WP_Error('backend_profile_changed', 'The backend profile changed. Reload this page before saving.', ['status' => 409]);
        }
        return $result;
    }

    public static function configure(array $body): array
    {
        self::assertEligible();
        $id = self::profileId($body['profileId'] ?? null);
        $registry = self::registry();
        $expected = self::expectedGeneration($body);
        if (($registry['generation'] ?? 0) !== $expected) throw new \RuntimeException('STALE_PROFILE');
        $current = self::settings();
        if (!$current) {
            $raw = get_option('smartcloud-wpsuite/site-settings', null) ?? get_option('hub-for-wpsuiteio/site-settings', null);
            if (!is_object($raw) && !is_array($raw)) throw new \RuntimeException('CONNECTION_REQUIRED');
            $current = SiteSettings::fromArray(is_object($raw) ? get_object_vars($raw) : $raw);
        }
        $fields = $body['connection'] ?? [];
        if (!is_array($fields)) throw new \InvalidArgumentException('INVALID_CONNECTION');
        $allowed = ['workspaceId', 'accountId', 'siteId', 'subscriber', 'workspaceApiMode', 'platformApiBaseUrl', 'platformConfigUrl', 'siteKey'];
        if (array_diff(array_keys($fields), $allowed)) throw new \InvalidArgumentException('INVALID_CONNECTION');
        $base = isset($registry['profiles'][$id])
            ? self::runWithContext(['id' => $id, 'bindingRevision' => $registry['profiles'][$id]['bindingRevision']], static fn() => self::settings()) : $current;
        $values = array_replace(get_object_vars($base), $fields);
        if (empty($fields['siteKey'])) {
            $identity = SiteSettings::normalizeIdentity($values);
            if ($identity['workspaceId'] !== $base->workspaceId || ($values['siteId'] ?? '') !== $base->siteId) throw new \InvalidArgumentException('KEY_REQUIRED');
            $values['siteKey'] = $base->siteKey;
        }
        $candidate = SiteSettings::fromArray($values);
        if (!$candidate->subscriber || !$candidate->workspaceId || !$candidate->siteId || !SiteSettings::usableSiteKey($candidate->siteKey)) throw new \InvalidArgumentException('CONNECTED_SUBSCRIBER_REQUIRED');
        if ($id === 'development' && ($candidate->workspaceApiMode !== 'workspace' || $candidate->platformApiBaseUrl !== 'https://api-dev.wpsuite.io')) throw new \InvalidArgumentException('INVALID_DEVELOPMENT_TARGET');
        if ($id === 'production' && $candidate->workspaceApiMode === 'workspace' && $candidate->platformApiBaseUrl !== 'https://api.wpsuite.io') throw new \InvalidArgumentException('INVALID_PRODUCTION_TARGET');
        if (isset($registry['profiles'][$id]) && $base->connectionFingerprint() !== $candidate->connectionFingerprint()) throw new \RuntimeException('PROFILE_REBIND_REQUIRES_MIGRATION');
        $record = self::newRecord($id, $candidate, $registry['profiles'][$id]['bindingRevision'] ?? 1, $body);
        $assets = self::validate($record, $candidate);
        $record['identity'] = $assets['identity'];
        $next = $registry;
        if (!$next) {
            $owner = $current->workspaceApiMode === 'workspace' && str_contains($current->platformApiBaseUrl, 'api-dev.wpsuite.io') ? 'development' : 'production';
            if ($owner === $id && $candidate->connectionFingerprint() !== $current->connectionFingerprint()) throw new \RuntimeException('PROFILE_REBIND_REQUIRES_MIGRATION');
            $next = ['schemaVersion' => 1, 'active' => $owner, 'generation' => 0, 'legacyStateOwner' => $owner, 'legacyBindingRevision' => 1,
                'profiles' => [$owner => self::newRecord($owner, $current, 1, [])]];
            $next['profiles'][$owner]['assets'] = ['jws' => get_option('smartcloud-wpsuiteio/license-jws', ''),
                'config' => get_option('smartcloud-wpsuiteio/config-encrypted', ''),
                'binding' => get_option('smartcloud-wpsuiteio/license-binding', ''),
                'refreshedAt' => (int) get_option('smartcloud-wpsuiteio/license-last-refresh', 0)];
            $next['profiles'][$owner]['identity'] = $owner === $id ? $assets['identity'] : self::validateBootstrap(['id' => $owner] + $next['profiles'][$owner], $current);
            // The original profile's settings and assets remain in their original namespace.
        }
        $next['profiles'][$id] = $record;
        $next['profiles'][$id]['assets'] = self::assetRecord($candidate, $assets);
        self::assertSeparateIdentities($next);
        $next['generation']++;
        self::commit($expected, $next);
        return self::status();
    }

    public static function activate(array $body): array
    {
        self::assertEligible();
        $registry = self::registry();
        $id = self::profileId($body['profileId'] ?? null);
        $expected = self::expectedGeneration($body);
        if (!$registry || $registry['generation'] !== $expected) throw new \RuntimeException('STALE_PROFILE');
        if (!isset($registry['profiles'][$id])) throw new \InvalidArgumentException('PROFILE_NOT_CONFIGURED');
        $assets = self::runWithContext(['id' => $id, 'bindingRevision' => $registry['profiles'][$id]['bindingRevision']], static function () use ($registry, $id): array {
            $settings = self::settings();
            $assets = self::validate(['id' => $id] + $registry['profiles'][$id], $settings);
            $others = [];
            foreach ($registry['profiles'] as $otherId => $record) if ($otherId !== $id) $others[] = ['id' => $otherId, 'bindingRevision' => $record['bindingRevision']];
            $valid = apply_filters('smartcloud_wpsuite_backend_profile_activation_check', true, self::captureContext(), $others);
            if ($valid !== true) throw new \RuntimeException('PROFILE_TARGET_CONFLICT');
            return $assets;
        });
        $registry['active'] = $id;
        $registry['generation']++;
        $settings = self::runWithContext(['id' => $id, 'bindingRevision' => $registry['profiles'][$id]['bindingRevision']], static fn() => self::settings());
        $registry['profiles'][$id]['assets'] = self::assetRecord($settings, $assets);
        $registry['profiles'][$id]['identity'] = $assets['identity'];
        self::assertSeparateIdentities($registry);
        self::commit($expected, $registry);
        return self::status();
    }

    /** Ordinary Hub connection saves update only the captured profile and preserve the other one. */
    public static function saveConnection(SiteSettings $settings): bool
    {
        $registry = self::registry();
        if (!$registry) return false;
        if (self::$override !== null) throw new \RuntimeException('Pinned render/job contexts cannot change a connection.');
        $id = $registry['active'];
        $old = self::settings();
        $record = $registry['profiles'][$id];
        if ($old->connectionFingerprint() !== $settings->connectionFingerprint()) throw new \RuntimeException('PROFILE_REBIND_REQUIRES_MIGRATION');
        $record['connection'] = SiteKeyStorage::encode($settings);
        $registry['profiles'][$id] = $record;
        $expected = self::$requestContext['generation'] ?? $registry['generation'];
        self::commit($expected, $registry);
        return true;
    }

    private static function newRecord(string $id, SiteSettings $settings, int $revision, array $body): array
    {
        $api = $body['legacyApiBaseUrl'] ?? ($id === 'production' ? 'https://api.wpsuite.io' : 'https://api-dev.wpsuite.io');
        $config = $body['legacyConfigUrl'] ?? 'https://wpsuite.io/static/config/' . ($id === 'production' ? 'prod' : 'dev') . '.json';
        if ($api !== ($id === 'production' ? 'https://api.wpsuite.io' : 'https://api-dev.wpsuite.io')
            || !is_string($config) || !preg_match('~^https://wpsuite\.io/static/config/[A-Za-z0-9/_\-.]+\.json$~D', $config)
            || str_contains($config, '..')) throw new \InvalidArgumentException('INVALID_LEGACY_TARGET');
        return ['id' => $id, 'bindingRevision' => $revision, 'connection' => SiteKeyStorage::encode($settings),
            'legacyApiBaseUrl' => $api, 'legacyConfigUrl' => $config];
    }

    private static function validate(array $record, SiteSettings $candidate): array
    {
        if (!is_callable(self::$validator)) throw new \RuntimeException('PROFILE_VALIDATOR_UNAVAILABLE');
        $identity = self::validateBootstrap($record, $candidate);
        $savedIdentity = self::registry()['profiles'][$record['id']]['identity'] ?? null;
        if (is_array($savedIdentity)) self::assertIdentityUnchanged($savedIdentity, $identity);
        $previous = self::$pending;
        self::$pending = $record;
        try { $assets = (self::$validator)($candidate); } finally { self::$pending = $previous; }
        if (!is_array($assets) || !is_string($assets['config'] ?? null) || !is_string($assets['jws'] ?? null)
            || !preg_match('/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/D', $assets['config'])
            || !preg_match('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/D', $assets['jws'])) throw new \RuntimeException('PROFILE_VALIDATION_FAILED');
        return $assets + ['identity' => $identity];
    }

    private static function validateBootstrap(array $record, SiteSettings $settings): array
    {
        $url = $settings->workspaceApiMode === 'workspace' ? $settings->platformConfigUrl : $record['legacyConfigUrl'];
        if (!preg_match('~^https://wpsuite\.io/static/config/[A-Za-z0-9/_\-.]+\.json$~D', $url) || str_contains($url, '..')) throw new \RuntimeException('PROFILE_BOOTSTRAP_INVALID');
        $response = wp_remote_get($url, ['timeout' => 10, 'redirection' => 0, 'limit_response_size' => 524288, 'cookies' => [], 'headers' => ['Accept' => 'application/json']]);
        if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) throw new \RuntimeException('PROFILE_BOOTSTRAP_UNAVAILABLE');
        $body = wp_remote_retrieve_body($response);
        $config = is_string($body) && strlen($body) <= 524288 ? json_decode($body, true) : null;
        $identity = self::validateIdentityTuple($config, $record['id']);
        if ($settings->workspaceApiMode === 'workspace') {
            if (($config['workspaceApiMode'] ?? '') !== 'workspace' || ($config['foundationApiBaseUrl'] ?? '') !== $settings->platformApiBaseUrl) throw new \RuntimeException('PROFILE_BOOTSTRAP_MISMATCH');
        } elseif (($config['workspaceApiMode'] ?? 'legacy') !== 'legacy' || ($config['config'] ?? '') !== 'prod' || $record['id'] !== 'production') {
            throw new \RuntimeException('PROFILE_BOOTSTRAP_MISMATCH');
        }
        return $identity;
    }

    /** One boundary for downloaded and persisted public identity; malformed state never falls back. */
    private static function validateIdentityTuple(mixed $config, string $id): array
    {
        if (!is_array($config) || ($config['baseUrl'] ?? '') !== ($id === 'production' ? 'https://wpsuite.io' : 'https://dev.wpsuite.io')
            || !is_string($config['awsRegion'] ?? null) || !preg_match('/^[a-z]{2}(?:-[a-z]+)+-\d$/D', $config['awsRegion'])
            || !is_string($config['userPoolId'] ?? null) || strlen($config['userPoolId']) > 128
            || !preg_match('/^' . preg_quote($config['awsRegion'], '/') . '_[A-Za-z0-9]+$/D', $config['userPoolId'])
            || !is_string($config['identityPoolId'] ?? null)
            || !preg_match('/^' . preg_quote($config['awsRegion'], '/') . ':[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/D', $config['identityPoolId'])
            || !is_string($config['appClientPlugin'] ?? null) || !preg_match('/^[a-z0-9]{1,128}$/D', $config['appClientPlugin'])
            || (array_key_exists('appClient', $config) && (!is_string($config['appClient']) || !preg_match('/^[a-z0-9]{1,128}$/D', $config['appClient'])))) {
            throw new \RuntimeException('PROFILE_BOOTSTRAP_INVALID');
        }
        return array_intersect_key($config, array_flip(['awsRegion', 'userPoolId', 'identityPoolId', 'appClientPlugin', 'appClient', 'baseUrl', 'workspaceApiMode', 'foundationApiBaseUrl']));
    }

    /** Updating JSON at the same URL must not silently retarget pinned jobs or identity authority. */
    private static function assertIdentityUnchanged(array $saved, array $fresh): void
    {
        $defaults = ['awsRegion' => '', 'userPoolId' => '', 'identityPoolId' => '', 'appClientPlugin' => '',
            'appClient' => '', 'baseUrl' => '', 'workspaceApiMode' => 'legacy', 'foundationApiBaseUrl' => ''];
        foreach ($defaults as $field => $default) {
            if (($saved[$field] ?? $default) !== ($fresh[$field] ?? $default)) throw new \RuntimeException('PROFILE_REBIND_REQUIRES_MIGRATION');
        }
    }

    private static function assetRecord(SiteSettings $settings, array $assets): array
    {
        return ['jws' => $assets['jws'], 'config' => $assets['config'], 'binding' => $settings->connectionFingerprint(), 'refreshedAt' => time()];
    }

    private static function assertSeparateIdentities(array $registry): void
    {
        $production = $registry['profiles']['production']['identity'] ?? null;
        $development = $registry['profiles']['development']['identity'] ?? null;
        if ($production && $development && (($production['userPoolId'] ?? '') === ($development['userPoolId'] ?? '')
            || ($production['identityPoolId'] ?? '') === ($development['identityPoolId'] ?? ''))) throw new \RuntimeException('PROFILE_IDENTITY_OVERLAP');
    }

    public static function saveAssets(SiteSettings $settings, array $assets): bool
    {
        $registry = self::registry();
        $context = self::captureContext();
        if (!$registry || !$context) return false;
        if (self::settings()->connectionFingerprint() !== $settings->connectionFingerprint()) throw new \RuntimeException('STALE_PROFILE');
        $registry['profiles'][$context['id']]['assets'] = self::assetRecord($settings, $assets);
        self::commit(self::$requestContext['generation'] ?? $registry['generation'], $registry);
        return true;
    }

    public static function clearAssets(): bool
    {
        $registry = self::registry(); $context = self::captureContext();
        if (!$registry || !$context) return false;
        $registry['profiles'][$context['id']]['assets'] = [];
        self::commit(self::$requestContext['generation'] ?? $registry['generation'], $registry);
        return true;
    }

    private static function commit(int $expected, array $next): void
    {
        global $wpdb;
        $lock = 'wpsuite-profiles-' . substr(hash('sha256', $wpdb->options), 0, 36);
        if ((string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s,0)', $lock)) !== '1') throw new \RuntimeException('PROFILE_BUSY');
        try {
            wp_cache_delete(self::OPTION, 'options'); wp_cache_delete('alloptions', 'options');
            $current = self::registry();
            if (($current['generation'] ?? 0) !== $expected || ($current['storageRevision'] ?? 0) !== ($next['storageRevision'] ?? 0)) throw new \RuntimeException('STALE_PROFILE');
            if ($current === null) {
                $ownerContext = ['id' => $next['legacyStateOwner'], 'bindingRevision' => $next['legacyBindingRevision']];
                if (apply_filters('smartcloud_wpsuite_backend_profile_initialization_check', true, $ownerContext) !== true) throw new \RuntimeException('PROFILE_INITIALIZATION_BLOCKED');
            }
            $next['storageRevision'] = ($current['storageRevision'] ?? 0) + 1;
            update_option(self::OPTION, $next, false);
            if (serialize(get_option(self::OPTION)) !== serialize($next)) throw new \RuntimeException('PROFILE_STORE_FAILED');
            self::$requestContext = ['id' => $next['active'], 'generation' => $next['generation']];
        } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); }
    }

    public static function renderHeaders(?array $context): array
    {
        if ($context === null) return [];
        return self::runWithContext($context, static function () use ($context): array {
            $payload = rtrim(strtr(base64_encode(json_encode(['v' => 1, 'id' => $context['id'], 'rev' => $context['bindingRevision'], 'exp' => time() + 7 * DAY_IN_SECONDS], JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
            return ['X-WPSuite-Render-Context' => $payload . '.' . hash_hmac('sha256', $payload, wp_salt('auth'))];
        });
    }

    private static function readRenderContext(): void
    {
        $token = $_SERVER['HTTP_X_WPSUITE_RENDER_CONTEXT'] ?? '';
        if ($token === '') return;
        try {
            $method = $_SERVER['REQUEST_METHOD'] ?? '';
            $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
            $publisherPost = $method === 'POST' && is_string($path) && str_starts_with($path, '/wp-json/') && self::publisherCallback(substr($path, strlen('/wp-json')));
            if (!is_string($token) || strlen($token) > 1024 || (!in_array($method, ['GET', 'HEAD'], true) && !$publisherPost)) throw new \RuntimeException('INVALID_RENDER_CONTEXT');
            $parts = explode('.', $token);
            if (count($parts) !== 2 || !hash_equals(hash_hmac('sha256', $parts[0], wp_salt('auth')), $parts[1])) throw new \RuntimeException('INVALID_RENDER_CONTEXT');
            $payload = json_decode(base64_decode(strtr($parts[0], '-_', '+/'), true), true, 8, JSON_THROW_ON_ERROR);
            if (($payload['v'] ?? null) !== 1 || !is_int($payload['exp'] ?? null) || $payload['exp'] < time()
                || $payload['exp'] > time() + 7 * DAY_IN_SECONDS) throw new \RuntimeException('INVALID_RENDER_CONTEXT');
            self::runWithContext(['id' => $payload['id'] ?? null, 'bindingRevision' => $payload['rev'] ?? null], static fn() => true);
            self::$override = ['id' => $payload['id'], 'bindingRevision' => $payload['rev']];
        } catch (\Throwable $error) { wp_die('The publishing profile is no longer valid.', '', ['response' => 403]); }
    }

    private static function publisherCallback(string $route): bool
    {
        return (bool) preg_match('~^/smartcloud-static-publisher/v1/(?:content-sync(?:/|$)|consent(?:/|$)|change-tokens/?$|page-cache/purge/?$|privacy/cookie-observations/?$)~D', $route);
    }

    private static function profileId(mixed $id): string
    {
        if (!in_array($id, ['production', 'development'], true)) throw new \InvalidArgumentException('INVALID_PROFILE');
        return $id;
    }
    private static function expectedGeneration(array $body): int
    {
        if (!is_int($body['expectedGeneration'] ?? null) || $body['expectedGeneration'] < 0) throw new \InvalidArgumentException('INVALID_GENERATION');
        return $body['expectedGeneration'];
    }
    private static function assertEligible(): void { if (!self::eligible()) throw new \RuntimeException('PROFILE_FORBIDDEN'); }
    private static function failure(\Throwable $error): \WP_Error
    {
        $code = $error->getMessage();
        $status = $code === 'STALE_PROFILE' ? 409 : (str_starts_with($code, 'INVALID_') || $error instanceof \InvalidArgumentException ? 400 : 503);
        return new \WP_Error('backend_profile_' . strtolower(preg_match('/^[A-Z_]+$/D', $code) ? $code : 'unavailable'),
            $status === 409 ? 'The backend profile changed. Reload and retry.' : 'The requested backend profile could not be validated or saved. The current selection was preserved.', ['status' => $status]);
    }
}
