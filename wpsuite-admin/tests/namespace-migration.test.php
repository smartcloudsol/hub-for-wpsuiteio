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

fwrite(STDOUT, "WP Suite namespace migration checks passed.\n");
