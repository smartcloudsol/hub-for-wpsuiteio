<?php

declare(strict_types=1);

use SmartCloud\WPSuite\Hub\HubAdmin;
use SmartCloud\WPSuite\Hub\SiteSettings;

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

function add_filter(string $hook, mixed $callback, int $priority = 10, int $accepted_args = 1): bool
{
    $GLOBALS['wpsuite_test_filters'][$hook] = array($callback, $priority, $accepted_args);
    return true;
}

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
    return $GLOBALS['wpsuite_test_options'][$key] ?? $default;
}

function update_option(string $key, mixed $value, mixed $autoload = null): bool
{
    $GLOBALS['wpsuite_test_options'][$key] = $value;
    return true;
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
    $GLOBALS['wpsuite_test_options']['smartcloud-wpsuite/site-settings'] === $settings,
    'Canonical site settings must be updated.'
);
expect(
    $GLOBALS['wpsuite_test_options']['hub-for-wpsuiteio/site-settings'] === $settings,
    'Legacy site settings must remain synchronized during rolling upgrades.'
);

$source = file_get_contents(dirname(__DIR__) . '/php/index.php');
expect(is_string($source), 'The shared runtime source must be readable.');
expect(substr_count($source, 'register_rest_route(') >= 2, 'Canonical and legacy REST routes must both be registered.');
expect(str_contains($source, 'renderLegacyAdminPage'), 'The legacy admin page alias must remain available.');

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
