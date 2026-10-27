<?php

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
require_once dirname(__DIR__) . '/php/model.php';
use SmartCloud\WPSuite\Hub\SiteSettings;

function check(bool $value, string $message): void {
    if (!$value) throw new RuntimeException($message);
}
$legacy = array('accountId' => 'ws-preserved', 'siteId' => 'site-preserved', 'siteKey' => 'synthetic', 'futureExtension' => array('enabled' => true));
$migrated = SiteSettings::fromArray($legacy);
check($migrated->workspaceId === 'ws-preserved' && $migrated->accountId === 'ws-preserved', 'Legacy ID was not preserved.');
check($migrated->siteId === 'site-preserved' && $migrated->futureExtension === $legacy['futureExtension'], 'Migration lost extension fields.');
check($migrated->workspaceApiMode === 'legacy', 'Migration must not activate new API.');
$canonical = SiteSettings::fromArray(array('workspaceId' => 'canonical', 'workspaceApiMode' => 'workspace'));
check($canonical->accountId === 'canonical', 'Legacy alias was not exposed.');
foreach (array(array('workspaceId' => 'one', 'accountId' => 'two'), array('workspaceId' => 123), array('workspaceId' => ' one'), array('workspaceApiMode' => 'automatic')) as $invalid) {
    try {
        SiteSettings::fromArray($invalid);
        throw new RuntimeException('Invalid identity or mode was accepted.');
    } catch (InvalidArgumentException $expected) {
    }
}
echo "workspace identity migration checks passed\n";

$platform = array(
    'workspaceApiMode' => 'workspace',
    'platformApiBaseUrl' => 'HTTPS://PRIVATE-API.EU-CENTRAL-1.EXAMPLE:443/dev///',
    'platformConfigUrl' => 'https://delivery.example/private/config/dev.json',
);
$bound = SiteSettings::fromArray($platform);
check($bound->platformApiBaseUrl === 'https://private-api.eu-central-1.example/dev', 'Explicit API URL was not normalized.');
check($bound->platformConfigUrl === $platform['platformConfigUrl'], 'Explicit configuration URL changed.');
check($migrated->platformApiBaseUrl === '' && $migrated->platformConfigUrl === '', 'Legacy settings acquired a platform binding.');
check(isset(get_object_vars($bound)['platformConfigUrl']), 'Public settings are missing the platform configuration URL.');
$invalid_platforms = array(
    array('platformApiBaseUrl' => $platform['platformApiBaseUrl']),
    array('platformConfigUrl' => $platform['platformConfigUrl']),
    array_replace($platform, array('platformApiBaseUrl' => '')),
    array_replace($platform, array('workspaceApiMode' => 'legacy')),
    array_replace($platform, array('platformApiBaseUrl' => null)),
    array_replace($platform, array('platformConfigUrl' => false)),
    array_replace($platform, array('platformConfigUrl' => 'https://delivery.example/config')),
);
foreach (array('platformApiBaseUrl', 'platformConfigUrl') as $field) {
    foreach (array('http://platform.example/config.json', '/config.json', 'https:///platform.example/config.json', 'https://user:password@platform.example/config.json', 'https://@platform.example/config.json', 'https://platform.example/config.json?token=value', 'https://platform.example/config.json?', 'https://platform.example/config.json#', 'https://platform.example/config.json#fragment', ' https://platform.example/config.json', 'https://platform.example/invalid\\config.json') as $url) {
        $invalid_platforms[] = array_replace($platform, array($field => $url));
    }
}
foreach ($invalid_platforms as $invalid_platform) {
    try {
        SiteSettings::fromArray($invalid_platform);
        throw new RuntimeException('Invalid platform binding was accepted.');
    } catch (InvalidArgumentException $expected) {
    }
}

// Only synthetic endpoints/settings reach this WordPress-free network stub.
define('SMARTCLOUD_WPSUITE_PATH', dirname(__DIR__) . '/php/');
define('SMARTCLOUD_WPSUITE_CANONICAL_SLUG', 'smartcloud-wpsuite');
define('SMARTCLOUD_WPSUITE_LEGACY_SLUG', 'hub-for-wpsuiteio');
class WP_Error {}
function get_site_url(): string { return $GLOBALS['platform_test_site_url']; }
function wp_remote_get(string $endpoint, array $args): WP_Error {
    $GLOBALS['platform_test_requests'][] = $endpoint;
    return new WP_Error();
}
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
require_once dirname(__DIR__) . '/php/index.php';
$hub_class = new ReflectionClass(\SmartCloud\WPSuite\Hub\HubAdmin::class);
$hub = $hub_class->newInstanceWithoutConstructor();
$site_settings_property = $hub_class->getProperty('siteSettings');
$reload = $hub_class->getMethod('reloadConfig');
$GLOBALS['platform_test_site_url'] = 'https://demo.example';
$GLOBALS['platform_test_requests'] = array();
$bound->workspaceId = $bound->accountId = 'workspace-example';
$bound->siteId = 'site-example';
$bound->siteKey = 'synthetic';
$site_settings_property->setValue($hub, $bound);
check($reload->invoke($hub, 'workspace-example', 'site-example', 'synthetic') === false, 'Synthetic explicit network error was not preserved.');
check($GLOBALS['platform_test_requests'] === array('https://private-api.eu-central-1.example/dev/workspace/workspace-example/site/site-example/license?licenseVersion=1'), 'Explicit API failed over or selected the production/default backend.');

$site_settings_property->setValue($hub, SiteSettings::fromArray(array('workspaceId' => 'legacy-workspace', 'siteId' => 'site-example', 'siteKey' => 'synthetic')));
$GLOBALS['platform_test_requests'] = array();
check($reload->invoke($hub, 'legacy-workspace', 'site-example', 'synthetic') === false, 'Legacy network failure changed.');
check($GLOBALS['platform_test_requests'] === array('https://api.wpsuite.io/account/legacy-workspace/site/site-example/license'), 'Unconfigured legacy backend selection changed.');
$GLOBALS['platform_test_site_url'] = 'https://dev.wpsuite.io';
$GLOBALS['platform_test_requests'] = array();
$reload->invoke($hub, 'legacy-workspace', 'site-example', 'synthetic');
check($GLOBALS['platform_test_requests'] === array('https://api-dev.wpsuite.io/account/legacy-workspace/site/site-example/license'), 'Legacy developer backend selection changed.');
foreach (array('https://wpsuite.io', 'https://dev.wpsuite.io.evil.example', 'https://other.example/?redirect=dev.wpsuite.io') as $site_url) {
    $GLOBALS['platform_test_site_url'] = $site_url; $GLOBALS['platform_test_requests'] = array();
    $reload->invoke($hub, 'legacy-workspace', 'site-example', 'synthetic');
    check($GLOBALS['platform_test_requests'] === array('https://api.wpsuite.io/account/legacy-workspace/site/site-example/license'), 'Non-dev WordPress hosts must not select the developer API.');
}
$GLOBALS['platform_test_site_url'] = 'https://dev.wpsuite.io';
$site_settings_property->setValue($hub, $bound); $GLOBALS['platform_test_requests'] = array();
$reload->invoke($hub, 'workspace-example', 'site-example', 'synthetic');
check($GLOBALS['platform_test_requests'] === array('https://private-api.eu-central-1.example/dev/workspace/workspace-example/site/site-example/license?licenseVersion=1'), 'Explicit secondary/private API must win over a dev-host default.');
echo "platform binding validation and fail-closed refresh checks passed\n";
