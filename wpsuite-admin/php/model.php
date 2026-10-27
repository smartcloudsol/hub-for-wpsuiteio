<?php
/**
 * Admin class to create settings page and  REST API endpoint to handle parameter updates coming from the settings front-end,
 * and load the settings.
 *
 */
namespace SmartCloud\WPSuite\Hub;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}
#[\AllowDynamicProperties]
class SiteSettings
{
    public function __construct(
        public string $accountId = "",
        public string $siteId = "",
        public int $lastUpdate = 0,
        public bool $subscriber = false,
        public string $siteKey = "",
        public string $reCaptchaPublicKey = "",
        public bool $useRecaptchaNet = false,
        public bool $useRecaptchaEnterprise = false,
        public bool $renderRecaptchaProvider = true,
        /** @var string[] Additional stylesheets loaded after WP Suite Theme CSS. */
        public array $themeCssUrls = array(),
        public string $workspaceId = "",
        public string $workspaceApiMode = "legacy",
        public string $platformApiBaseUrl = "",
        public string $platformConfigUrl = "",
    ) {
        $this->siteKey = self::usableSiteKey($siteKey) ? $siteKey : '';
        $identity = self::normalizeIdentity(array('workspaceId' => $workspaceId, 'accountId' => $accountId));
        $this->workspaceId = $identity['workspaceId'];
        $this->accountId = $identity['accountId'];
        if (!in_array($workspaceApiMode, array('legacy', 'workspace'), true)) {
            throw new \InvalidArgumentException('Unsupported workspace API mode.');
        }
        $platform = self::normalizePlatformConnection(array(
            'workspaceApiMode' => $workspaceApiMode,
            'platformApiBaseUrl' => $platformApiBaseUrl,
            'platformConfigUrl' => $platformConfigUrl,
        ));
        $this->platformApiBaseUrl = $platform['platformApiBaseUrl'];
        $this->platformConfigUrl = $platform['platformConfigUrl'];
    }

    /** Invalid historical sentinels remain repairable, but can never authenticate a connection. */
    public static function usableSiteKey(mixed $value): bool
    {
        return is_string($value) && $value !== '' && !str_starts_with($value, 'wpsuite-key:')
            && !in_array(strtolower($value), array('undefined', 'null'), true)
            && !preg_match('/[\\s\\x00-\\x1f\\x7f]/', $value);
    }

    /** Bind even legacy v1 assets, which lack tenant claims, to the complete local connection. */
    public function connectionFingerprint(): string
    {
        return hash('sha256', json_encode(array(
            $this->workspaceId, $this->siteId, $this->siteKey, $this->workspaceApiMode,
            $this->platformApiBaseUrl, $this->platformConfigUrl,
        ), JSON_THROW_ON_ERROR));
    }

    public static function normalizeIdentity(array $values): array
    {
        foreach (array('workspaceId', 'accountId') as $key) {
            if (isset($values[$key]) && !is_string($values[$key])) {
                throw new \InvalidArgumentException('Workspace identity must be a string.');
            }
            if (isset($values[$key]) && trim($values[$key]) !== $values[$key]) {
                throw new \InvalidArgumentException('Workspace identity must not contain surrounding whitespace.');
            }
        }
        $workspace = $values['workspaceId'] ?? '';
        $account = $values['accountId'] ?? '';
        if ($workspace !== '' && $account !== '' && $workspace !== $account) {
            throw new \InvalidArgumentException('Conflicting workspaceId and accountId.');
        }
        $workspace = $workspace !== '' ? $workspace : $account;
        return array('workspaceId' => $workspace, 'accountId' => $workspace);
    }

    /** Explicit platform endpoints are a pair and never imply an automatic environment switch. */
    public static function normalizePlatformConnection(array $values): array
    {
        $urls = array();
        foreach (array('platformApiBaseUrl', 'platformConfigUrl') as $field) {
            $value = $values[$field] ?? '';
            if (array_key_exists($field, $values) && !is_string($values[$field])) {
                throw new \InvalidArgumentException('Platform connection URLs must be strings.');
            }
            $urls[$field] = $value;
        }
        if ($urls['platformApiBaseUrl'] === '' && $urls['platformConfigUrl'] === '') return $urls;
        if ($urls['platformApiBaseUrl'] === '' || $urls['platformConfigUrl'] === '') {
            throw new \InvalidArgumentException('platformApiBaseUrl and platformConfigUrl must be supplied together.');
        }
        if (($values['workspaceApiMode'] ?? 'legacy') !== 'workspace') {
            throw new \InvalidArgumentException('Explicit platform connection requires workspace API mode.');
        }
        foreach ($urls as $field => $value) {
            $parts = parse_url($value);
            if (preg_match('/[\\\\\s?#\x00-\x1f\x7f]/', $value) || filter_var($value, FILTER_VALIDATE_URL) === false || !is_array($parts)
                || strtolower($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])
                || isset($parts['user']) || isset($parts['pass'])) {
                throw new \InvalidArgumentException('Platform connection requires absolute HTTPS URLs without credentials, query or fragment.');
            }
            $path = $parts['path'] ?? '/';
            $segments = explode('/', $path);
            $normalized = array();
            foreach ($segments as $index => $segment) {
                $dots = str_ireplace('%2e', '.', $segment);
                if ($dots === '.' || $dots === '..') {
                    if ($dots === '..' && count($normalized) > 1) array_pop($normalized);
                    if ($index === count($segments) - 1) $normalized[] = '';
                } else {
                    $normalized[] = $segment;
                }
            }
            $path = implode('/', $normalized);
            if ($field === 'platformConfigUrl' && !preg_match('/\.json$/iD', $path)) {
                throw new \InvalidArgumentException('platformConfigUrl must name a JSON configuration file.');
            }
            $port = isset($parts['port']) && $parts['port'] !== 443 ? ':' . $parts['port'] : '';
            $url = 'https://' . strtolower($parts['host']) . $port . $path;
            $urls[$field] = $field === 'platformApiBaseUrl' ? rtrim($url, '/') : $url;
        }
        return $urls;
    }

    /** Local-state migration preserves extension fields and the existing connection IDs. */
    public static function fromArray(array $values): self
    {
        $identity = self::normalizeIdentity($values);
        $platform = self::normalizePlatformConnection($values);
        $settings = new self(
            accountId: $identity['accountId'],
            siteId: (string) ($values['siteId'] ?? ''),
            lastUpdate: (int) ($values['lastUpdate'] ?? 0),
            subscriber: (bool) ($values['subscriber'] ?? false),
            siteKey: self::usableSiteKey($values['siteKey'] ?? null) ? $values['siteKey'] : '',
            reCaptchaPublicKey: (string) ($values['reCaptchaPublicKey'] ?? ''),
            useRecaptchaNet: (bool) ($values['useRecaptchaNet'] ?? false),
            useRecaptchaEnterprise: (bool) ($values['useRecaptchaEnterprise'] ?? false),
            renderRecaptchaProvider: (bool) ($values['renderRecaptchaProvider'] ?? true),
            themeCssUrls: is_array($values['themeCssUrls'] ?? null) ? $values['themeCssUrls'] : array(),
            workspaceId: $identity['workspaceId'],
            workspaceApiMode: (string) ($values['workspaceApiMode'] ?? 'legacy'),
            platformApiBaseUrl: $platform['platformApiBaseUrl'],
            platformConfigUrl: $platform['platformConfigUrl'],
        );
        foreach ($values as $key => $value) {
            if (!property_exists($settings, $key)) $settings->$key = $value;
        }
        return $settings;
    }
}

/** Encrypt only persisted credentials; callers keep the existing runtime settings model. */
final class SiteKeyStorage
{
    public const PREFIX = 'wpsuite-key:v1:';
    private const OPTIONS = array('smartcloud-wpsuite/site-settings', 'hub-for-wpsuiteio/site-settings');
    private static array $raw = array();
    private static array $errors = array();
    private static array $migrationFailures = array();
    private static bool $registered = false;

    /** Metadata only: never return constants, derived keys or stored ciphertext. */
    public static function availability(): array
    {
        $constants = array();
        foreach (array('AUTH_KEY', 'SECURE_AUTH_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT') as $name) {
            $value = defined($name) ? constant($name) : null;
            $constants[$name] = is_string($value) && strlen($value) >= 64
                && count(array_unique(str_split($value))) >= 16
                && stripos($value, 'put your unique phrase here') === false;
        }
        $crypto = function_exists('hash_hkdf') && function_exists('openssl_encrypt')
            && function_exists('openssl_decrypt') && in_array('aes-256-gcm', openssl_get_cipher_methods(), true);
        return array('constantsStrong' => $constants, 'cryptoAvailable' => $crypto,
            'ready' => $crypto && !in_array(false, $constants, true));
    }

    private static function key(): string
    {
        if (!self::availability()['ready']) throw new \RuntimeException('Site key encryption requires strong wp-config auth keys/salts and AES-256-GCM.');
        $material = '';
        foreach (array('AUTH_KEY', 'SECURE_AUTH_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT') as $name) {
            $value = constant($name);
            $material .= pack('N', strlen($name)) . $name . pack('N', strlen($value)) . $value;
        }
        return hash_hkdf('sha256', $material, 32, 'wpsuite/site-key/storage/v1');
    }

    private static function values(mixed $settings): array
    {
        if (!is_array($settings) && !is_object($settings)) throw new \RuntimeException('Invalid site credential storage.');
        return is_object($settings) ? get_object_vars($settings) : $settings;
    }

    private static function withKey(mixed $settings, string $key): mixed
    {
        if (is_object($settings)) { $copy = clone $settings; $copy->siteKey = $key; return $copy; }
        $copy = $settings; $copy['siteKey'] = $key; return $copy;
    }

    private static function aad(mixed $settings): string
    {
        $values = self::values($settings);
        $identity = SiteSettings::normalizeIdentity($values);
        $platform = SiteSettings::normalizePlatformConnection($values);
        return json_encode(array('wpsuite-site-key-v1', $identity['workspaceId'], (string) ($values['siteId'] ?? ''),
            (string) ($values['workspaceApiMode'] ?? 'legacy'), $platform['platformApiBaseUrl'], $platform['platformConfigUrl']), JSON_THROW_ON_ERROR);
    }

    public static function isSealed(mixed $key): bool
    {
        return is_string($key) && str_starts_with($key, 'wpsuite-key:');
    }

    private static function open(mixed $settings): string
    {
        $stored = self::values($settings)['siteKey'] ?? '';
        if (!is_string($stored) || !str_starts_with($stored, self::PREFIX)) throw new \RuntimeException('Unsupported stored site key version.');
        $json = base64_decode(substr($stored, strlen(self::PREFIX)), true);
        $envelope = is_string($json) ? json_decode($json, true) : null;
        if (!is_array($envelope) || ($envelope['v'] ?? null) !== 1 || ($envelope['alg'] ?? '') !== 'A256GCM') throw new \RuntimeException('Invalid stored site key envelope.');
        $iv = base64_decode((string) ($envelope['iv'] ?? ''), true);
        $tag = base64_decode((string) ($envelope['tag'] ?? ''), true);
        $ciphertext = base64_decode((string) ($envelope['data'] ?? ''), true);
        if (!is_string($iv) || strlen($iv) !== 12 || !is_string($tag) || strlen($tag) !== 16 || !is_string($ciphertext) || $ciphertext === '') throw new \RuntimeException('Invalid stored site key envelope.');
        $plain = openssl_decrypt($ciphertext, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag, self::aad($settings));
        if (!SiteSettings::usableSiteKey($plain)) throw new \RuntimeException('Stored site key cannot be decrypted. Restore the original wp-config auth keys/salts or reconnect explicitly.');
        return $plain;
    }

    public static function registerFilters(): void
    {
        if (self::$registered) return;
        self::$registered = true;
        foreach (self::OPTIONS as $name) add_filter('option_' . $name, static fn($value) => self::read($value, $name));
    }

    /** Always clone objects: WordPress may hand out its cached raw object by reference. */
    public static function read(mixed $stored, string $name): mixed
    {
        if (!is_array($stored) && !is_object($stored)) return $stored;
        self::$raw[$name] = is_object($stored) ? clone $stored : $stored;
        $key = self::values($stored)['siteKey'] ?? '';
        try {
            if (self::isSealed($key)) { $key = self::open($stored); unset(self::$migrationFailures[$name]); }
            elseif (isset(self::$migrationFailures[$name])) throw new \RuntimeException('Site key storage migration failed.');
            elseif (SiteSettings::usableSiteKey($key) && !self::availability()['ready']) throw new \RuntimeException('Site key storage encryption is unavailable. Configure strong wp-config auth keys/salts.');
            if (SiteSettings::usableSiteKey($key) && str_contains(serialize(self::withKey($stored, '')), $key)) throw new \RuntimeException('Duplicate plaintext credential in site settings.');
            unset(self::$errors[$name]);
            return self::withKey($stored, is_string($key) ? $key : '');
        } catch (\Throwable $error) {
            self::$errors[$name] = true;
            return self::withKey($stored, '');
        }
    }

    /** Same binding/key reuses valid sealed bytes; arbitrary new input is always authenticated. */
    public static function encode(mixed $runtime): mixed
    {
        $values = self::values($runtime); $key = $values['siteKey'] ?? '';
        $identity = SiteSettings::normalizeIdentity($values);
        $disconnect = $identity['workspaceId'] === '' && ($values['siteId'] ?? '') === '';
        if (!SiteSettings::usableSiteKey($key)) {
            if (!$disconnect && self::$errors) throw new \RuntimeException('The stored site key is locked. Restore the original wp-config auth keys/salts or reconnect explicitly.');
            if (self::isSealed($key)) throw new \RuntimeException('Encrypted site keys are not runtime credentials.');
            return self::withKey($runtime, '');
        }
        if (str_contains(serialize(self::withKey($runtime, '')), $key)) throw new \RuntimeException('A duplicate plaintext site credential must be removed before encrypted storage.');
        $aad = self::aad($runtime);
        foreach (self::$raw as $stored) {
            if (!self::isSealed(self::values($stored)['siteKey'] ?? '')) continue;
            try {
                if (self::aad($stored) === $aad && hash_equals(self::open($stored), $key)) {
                    return self::withKey($runtime, self::values($stored)['siteKey']);
                }
            } catch (\Throwable $error) { /* Explicit valid reconnect can replace a locked envelope. */ }
        }
        $iv = random_bytes(12); $tag = '';
        $ciphertext = openssl_encrypt($key, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag, $aad, 16);
        if (!is_string($ciphertext) || strlen($tag) !== 16) throw new \RuntimeException('Site key encryption failed.');
        $sealed = self::PREFIX . base64_encode(json_encode(array('v' => 1, 'alg' => 'A256GCM', 'iv' => base64_encode($iv), 'tag' => base64_encode($tag), 'data' => base64_encode($ciphertext)), JSON_THROW_ON_ERROR));
        $candidate = self::withKey($runtime, $sealed);
        if (!hash_equals(self::open($candidate), $key)) throw new \RuntimeException('Site key encryption verification failed.');
        return $candidate;
    }

    /** First healthy Hub boot migrates plaintext mirrors without changing runtime identity/key. */
    public static function migratePlaintextOptions(): void
    {
        foreach (self::OPTIONS as $name) {
            $runtime = get_option($name, null); $raw = self::$raw[$name] ?? null;
            if ($raw === null || self::isSealed(self::values($raw)['siteKey'] ?? '')) continue;
            if (!SiteSettings::usableSiteKey(self::values($raw)['siteKey'] ?? '')) continue;
            try {
                if (isset(self::$errors[$name])) continue;
                $sealed = self::encode($runtime);
                update_option($name, $sealed, false);
                get_option($name, null);
                if (!self::isSealed(self::values(self::$raw[$name] ?? array())['siteKey'] ?? '')) { self::$errors[$name] = true; self::$migrationFailures[$name] = true; }
            } catch (\Throwable $error) { self::$errors[$name] = true; self::$migrationFailures[$name] = true; }
        }
    }

    public static function state(): array
    {
        $options = array();
        foreach (self::OPTIONS as $name) {
            $raw = self::$raw[$name] ?? array();
            $sealed = self::isSealed(self::values($raw)['siteKey'] ?? '');
            $duplicate = null;
            if ($sealed && !isset(self::$errors[$name])) {
                try { $duplicate = str_contains(serialize(self::withKey($raw, '')), self::open($raw)); }
                catch (\Throwable $error) { self::$errors[$name] = true; }
            }
            $options[$name] = array('sealed' => $sealed, 'locked' => isset(self::$errors[$name]), 'plaintextDuplicate' => $duplicate);
        }
        return $options;
    }

    public static function notice(): void
    {
        if (!self::$errors || !current_user_can('manage_options')) return;
        echo '<div class="notice notice-error"><p>WP Suite cannot unlock its stored site connection. Restore the original strong wp-config auth keys/salts or reconnect this site explicitly. The stored connection has been preserved.</p></div>';
    }
}
