<?php
/** Real packaged plugin load in disposable WordPress; no source aliases or external HTTP. */
declare(strict_types=1);
$root = $argv[1] ?? '';
$scenario = $argv[2] ?? '';
$manifestPath = $argv[3] ?? '';
if (!preg_match('~^/tmp/wpsuite-backend-profiles\.[^/]+/wordpress$~D', $root)
    || !in_array($scenario, ['install', 'activate', 'frontend', 'admin'], true)
    || $manifestPath !== dirname($root) . '/packaged-manifest.json'
    || getenv('WPSUITE_PROFILE_PACKAGE_RUN') !== '1') throw new RuntimeException('Disposable package fixture required');
$manifest = json_decode(file_get_contents($manifestPath), true, flags: JSON_THROW_ON_ERROR);
if (count($manifest) !== 7) throw new RuntimeException('Exactly seven final plugin packages required');
$checks = 0;
function expect_package(bool $value, string $message): void { global $checks; $checks++; if (!$value) throw new RuntimeException($message); }
$_SERVER['HTTP_HOST'] = 'dev.wpsuite.io'; $_SERVER['HTTPS'] = 'on';
$_SERVER['REQUEST_METHOD'] = 'GET'; $_SERVER['REQUEST_URI'] = $scenario === 'admin' ? '/wp-admin/admin.php?page=smartcloud-wpsuite' : '/';
if ($scenario === 'install') define('WP_INSTALLING', true);
if (in_array($scenario, ['activate', 'admin'], true)) {
    define('WP_ADMIN', true); $_GET['page'] = 'smartcloud-wpsuite';
    $GLOBALS['pagenow'] = 'admin.php';
}
// Missing packaged includes must fail at their first warning, before a later fatal.
set_error_handler(static function (int $level, string $message, string $file, int $line): bool {
    if (($level & (E_WARNING | E_USER_WARNING | E_RECOVERABLE_ERROR)) && str_contains($file, '/wp-content/plugins/')) {
        throw new ErrorException($message, 0, $level, $file, $line);
    }
    return false;
});
require $root . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/admin.php';
expect_package($wp_version === '7.1', 'Expected actual cached WordPress 7.1');
expect_package($wpdb->prefix === 'package_', 'Packaged smoke must use separate SQL tables');
if ($scenario === 'install') {
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    wp_install('Synthetic packaged plugin fixture', 'package-admin', 'package@example.test', false, '', wp_generate_password());
    echo "Installed isolated packaged-plugin WordPress tables.\n"; exit;
}
$admin = get_user_by('login', 'package-admin');
expect_package($admin instanceof WP_User, 'Synthetic local administrator missing');
wp_set_current_user($admin->ID);
$entries = array_column($manifest, 'entry');
if ($scenario === 'activate') {
    expect_package(count(get_plugins()) === 7, 'Disposable plugin directory contains unexpected plugins');
    foreach ($entries as $entry) {
        $result = activate_plugin($entry, '', false, false);
        expect_package(!is_wp_error($result), 'Packaged activation failed: ' . $entry . (is_wp_error($result) ? ' ' . $result->get_error_message() : ''));
    }
    $active = get_option('active_plugins', []); sort($active); $expected = $entries; sort($expected);
    expect_package($active === $expected, 'All seven packaged plugins were not activated');
    echo 'Packaged activation PASS: 7 plugins, ' . $checks . " checks.\n"; exit;
}
$active = get_option('active_plugins', []); sort($active); $expected = $entries; sort($expected);
expect_package($active === $expected, 'Fresh WordPress request did not retain all seven active plugins');
expect_package(did_action('plugins_loaded') > 0 && did_action('init') > 0, 'Normal WordPress plugin/init lifecycle did not run');
if ($scenario === 'admin') {
    set_current_screen('dashboard');
    do_action('admin_init');
    do_action('admin_menu');
    expect_package(is_admin(), 'Synthetic admin request did not load admin paths');
}
$routes = rest_get_server()->get_routes();
foreach ([
    '/smartcloud-wpsuite/v1/update-site-settings',
    '/smartcloud-wpsuite/v1/backend-profiles',
    '/gatey/v1/admin/page-suggestions',
    '/smartcloud-ai-kit/v1/answers-settings',
    '/smartcloud-flow/v1/update-settings',
    '/smartcloud-static-publisher/v1/state',
    '/smartcloud-consent/v1/state',
    '/smartcloud-content-relations/v1/definitions',
] as $route) expect_package(isset($routes[$route]), 'Packaged REST registration missing: ' . $route);
expect_package(function_exists('wp_get_abilities'), 'Actual WordPress Abilities API missing');
$abilities = wp_get_abilities();
foreach ([
    'gatey/get-runtime-capabilities',
    'smartcloud-ai-kit/get-runtime-capabilities',
    'smartcloud-flow/get-runtime-capabilities',
    'smartcloud-static-publisher/list-targets',
    'smartcloud-agent-composer/get-status',
] as $name) expect_package(wp_get_ability($name) !== null, 'Packaged ability discovery missing: ' . $name);
expect_package(class_exists('SmartCloud\\WPSuite\\Hub\\HubAdmin', false), 'Packaged HubAdmin constructor did not load');
expect_package(class_exists('SmartCloud\\WPSuite\\AiKit\\KnowledgeBase\\BackendProfileState', false), 'Packaged AI profile state include did not load');
expect_package(class_exists('SmartCloud\\WPSuite\\Flow\\BackendProfileState', false), 'Packaged Flow profile state include did not load');
$included = array_map('realpath', get_included_files());
foreach ($manifest as $package) expect_package(in_array(realpath(WP_PLUGIN_DIR . '/' . $package['entry']), $included, true), 'Fresh load skipped package entry: ' . $package['slug']);
$sourceRoot = dirname(__DIR__, 3) . '/';
$allowedSource = [realpath(__FILE__), realpath(__DIR__ . '/site-key-storage-fixture.php')];
foreach ($included as $file) {
    expect_package(!str_starts_with($file, $sourceRoot) || in_array($file, $allowedSource, true), 'Source alias leaked into packaged runtime: ' . $file);
}
foreach (['SmartCloud\\WPSuite\\Hub\\HubAdmin', 'SmartCloud\\WPSuite\\AiKit\\Abilities\\Provider', 'SmartCloud\\WPSuite\\Flow\\Abilities\\Provider'] as $class) {
    expect_package(str_starts_with((new ReflectionClass($class))->getFileName(), WP_PLUGIN_DIR . '/'), 'Provider class did not originate from final ZIP: ' . $class);
}
$blocked = wp_remote_get('https://package-smoke.invalid/never-network');
expect_package(is_wp_error($blocked) && $blocked->get_error_code() === 'offline_test', 'Existing mu-plugin HTTP block was bypassed');
echo 'Packaged ' . $scenario . ' load PASS: 7 plugins, ' . count($routes) . ' REST routes, ' . count($abilities) . ' abilities, ' . $checks . " checks.\n";
