<?php

declare(strict_types=1);

use SmartCloud\WPSuite\Hub\HubAdmin;
use SmartCloud\WPSuite\Hub\SiteSettings;
require_once __DIR__ . '/site-key-storage-fixture.php';

define('ABSPATH', __DIR__ . '/');
define('SMARTCLOUD_WPSUITE_PATH', dirname(__DIR__) . '/php/');
define('SMARTCLOUD_WPSUITE_CANONICAL_SLUG', 'smartcloud-wpsuite');
define('SMARTCLOUD_WPSUITE_LEGACY_SLUG', 'hub-for-wpsuiteio');

$GLOBALS['wpsuite_test_options'] = array(
    'hub-for-wpsuiteio/site-settings' => array(
        'accountId' => 'account-1',
        'siteId' => 'site-1',
        'siteKey' => 'site-key-1',
        'subscriber' => true,
    ),
);
$GLOBALS['wpsuite_test_filters'] = array();
$GLOBALS['wpsuite_test_custom_css'] = '/* operator CSS */';

class WP_Error
{
    public function __construct(public string $code = '', public string $message = '', public array $data = array())
    {
    }
}

class WP_REST_Request
{
    public function __construct(private string $body) {}
    public function get_body(): string { return $this->body; }
}
function get_site_url(): string { return 'https://demo.wpsuite.io'; }
function wp_remote_get(string $endpoint, array $args): WP_Error {
    $GLOBALS['wpsuite_test_license_endpoint'] = $endpoint;
    return new WP_Error('synthetic_network_disabled');
}

function add_filter(string $hook, mixed $callback, int $priority = 10, int $accepted_args = 1): bool
{
    $GLOBALS['wpsuite_test_filters'][$hook] = array($callback, $priority, $accepted_args);
    return true;
}

function add_action(string $hook, mixed $callback, int $priority = 10, int $accepted_args = 1): bool { return true; }

function current_user_can(string $capability): bool
{
    return $capability === 'edit_css';
}

function __(string $text, string $domain = 'default'): string
{
    return $text;
}

function wp_get_custom_css(string $stylesheet = ''): string
{
    return $GLOBALS['wpsuite_test_custom_css'];
}

function wp_update_custom_css_post(string $css, array $args = array()): object
{
    $GLOBALS['wpsuite_test_custom_css'] = $css;
    return (object) array('ID' => 1);
}

function is_wp_error(mixed $value): bool
{
    return $value instanceof WP_Error;
}

function get_option(string $key, mixed $default = false): mixed
{
    $value = $GLOBALS['wpsuite_test_options'][$key] ?? $default;
    $filter = $GLOBALS['wpsuite_test_filters']['option_' . $key][0] ?? null;
    return $filter ? $filter($value) : $value;
}

function update_option(string $key, mixed $value, mixed $autoload = null): bool
{
    $GLOBALS['wpsuite_test_options'][$key] = $value;
    return true;
}

function home_url(string $path = ''): string
{
    return 'https://example.com/subsite' . $path;
}

function trailingslashit(string $value): string
{
    return rtrim($value, '/') . '/';
}

function add_query_arg(string $key, string $value, string $url): string
{
    return $url . (str_contains($url, '?') ? '&' : '?') . rawurlencode($key) . '=' . rawurlencode($value);
}

function wp_parse_url(string $url): array|false
{
    return parse_url($url);
}

function esc_url_raw(string $url, array $protocols = array()): string
{
    return $url;
}

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

require_once dirname(__DIR__) . '/php/index.php';

$admin = new HubAdmin();
$normalize_urls = new ReflectionMethod(HubAdmin::class, 'normalizeThemeCssUrls');
$urls = $normalize_urls->invoke($admin, array('/assets/shared.css', 'css/components.css', 'https://cdn.example.org/ui.css?v=2', '/assets/shared.css'));
expect(
    $urls === array(
        'https://example.com/subsite/assets/shared.css',
        'https://example.com/subsite/css/components.css',
        'https://cdn.example.org/ui.css?v=2',
    ),
    'Stylesheet URLs must resolve against the current site and preserve order without duplicates.'
);
expect(is_wp_error($normalize_urls->invoke($admin, array('javascript:alert(1)'))), 'Script URLs must be rejected.');
expect(is_wp_error($normalize_urls->invoke($admin, array('//other.example.org/x.css'))), 'Protocol-relative URLs must be rejected.');
expect(is_wp_error($normalize_urls->invoke($admin, array('../escape.css'))), 'Parent-relative URLs must be rejected.');
expect(is_wp_error($normalize_urls->invoke($admin, array('/css/%2e%2e/escape.css'))), 'Encoded parent-relative URLs must be rejected.');
expect(is_wp_error($normalize_urls->invoke($admin, array('https://user:pass@example.org/x.css'))), 'Credential-bearing URLs must be rejected.');
expect(is_wp_error($normalize_urls->invoke($admin, array('https://example.org/</script>.css'))), 'HTML-sensitive URL markup must be rejected.');
expect(
    isset($GLOBALS['wpsuite_test_filters']['smartcloud_wpsuite_replace_theme_css_fragment']),
    'The managed Theme CSS fragment contract must be registered.'
);
expect(
    ($GLOBALS['wpsuite_test_options']['smartcloud-wpsuite/site-settings']['accountId'] ?? '') === 'account-1',
    'The legacy site-settings option must migrate to the canonical namespace.'
);
expect(
    ($GLOBALS['wpsuite_test_options']['smartcloud-wpsuite/namespace-migration-version'] ?? '') === '1',
    'The namespace migration version must be recorded.'
);

$write = new ReflectionMethod(HubAdmin::class, 'writeSiteSettingsOptions');
$settings = new SiteSettings(accountId: 'account-2', siteId: 'site-2', siteKey: 'site-key-2');
$write->invoke($admin, $settings);
expect(
    serialize(get_option('smartcloud-wpsuite/site-settings')) === serialize($settings),
    'Canonical site settings must be updated.'
);
expect(
    serialize(get_option('hub-for-wpsuiteio/site-settings')) === serialize($settings),
    'Legacy site settings must remain synchronized during rolling upgrades.'
);

$settings->themeCssUrls = array('https://example.com/subsite/assets/shared.css', 'https://cdn.example.org/ui.css');
$settings_property = new ReflectionProperty(HubAdmin::class, 'siteSettings');
$settings_property->setValue($admin, $settings);
$ordered_stylesheets = $admin->filterThemeCssUrls(array());
expect(count($ordered_stylesheets) === 3, 'The shared stylesheet filter must include managed CSS and all additional URLs.');
expect($ordered_stylesheets[0] === $admin->getThemeCssUrl(), 'Managed Theme CSS must load before additional stylesheets.');
expect(array_slice($ordered_stylesheets, 1) === $settings->themeCssUrls, 'Additional stylesheets must preserve their configured order.');

$reload = new ReflectionMethod(HubAdmin::class, 'reloadConfig');
$reload->invoke($admin, 'account-2', 'site-2', 'site-key-2');
expect($GLOBALS['wpsuite_test_license_endpoint'] === 'https://api.wpsuite.io/account/account-2/site/site-2/license', 'Legacy licence URL must remain unchanged.');
$settings->workspaceApiMode = 'workspace';
$reload->invoke($admin, 'account-2', 'site-2', 'site-key-2');
expect($GLOBALS['wpsuite_test_license_endpoint'] === 'https://api.wpsuite.io/workspace/account-2/site/site-2/license?licenseVersion=1', 'Canonical tenant routing must explicitly negotiate the existing v1 licence contract.');
$before = $GLOBALS['wpsuite_test_options'];
$conflict = $admin->updateSiteSettings(new WP_REST_Request('{"workspaceId":"one","accountId":"two"}'));
expect($conflict instanceof WP_Error && ($conflict->data['status'] ?? 0) === 400, 'Conflicting REST identities must return 400.');
expect($GLOBALS['wpsuite_test_options'] === $before, 'Rejected identities must not change local options.');

$source = file_get_contents(dirname(__DIR__) . '/php/index.php');
expect(is_string($source), 'The shared runtime source must be readable.');
expect(substr_count($source, 'register_rest_route(') >= 2, 'Canonical and legacy REST routes must both be registered.');
expect(str_contains($source, 'renderLegacyAdminPage'), 'The legacy admin page alias must remain available.');
expect(str_contains($source, "'/custom-translations'"), 'The custom translation management route must be registered.');
expect(str_contains($source, "'custom-translations.json'"), 'The custom translation virtual asset must be registered.');
expect(str_contains($source, "'customTranslationsDefaultLocale'"), 'The shared translation default locale must be bootstrapped.');

$result = $admin->replaceThemeCssFragment(null, 'smartcloud-agent-starter', ':host { color: red; }');
expect(is_array($result) && ($result['success'] ?? false), 'A valid managed Theme CSS fragment must be saved.');
expect(str_contains($GLOBALS['wpsuite_test_custom_css'], '/* operator CSS */'), 'Operator CSS must be preserved.');
expect(substr_count($GLOBALS['wpsuite_test_custom_css'], 'smartcloud-agent-starter begin') === 1, 'The owner fragment must be unique.');
$admin->replaceThemeCssFragment(null, 'smartcloud-agent-starter', ':host { color: blue; }');
expect(!str_contains($GLOBALS['wpsuite_test_custom_css'], 'color: red'), 'Replacing a fragment must remove the previous owner content.');
expect(str_contains($GLOBALS['wpsuite_test_custom_css'], 'color: blue'), 'Replacing a fragment must save the new owner content.');
$admin->replaceThemeCssFragment(null, 'smartcloud-agent-starter', '');
expect(!str_contains($GLOBALS['wpsuite_test_custom_css'], 'smartcloud-agent-starter begin'), 'An empty fragment must remove the owner section.');
expect($GLOBALS['wpsuite_test_custom_css'] === '/* operator CSS */', 'Removing a fragment must preserve all unrelated CSS.');

fwrite(STDOUT, "WP Suite namespace migration checks passed.\n");
