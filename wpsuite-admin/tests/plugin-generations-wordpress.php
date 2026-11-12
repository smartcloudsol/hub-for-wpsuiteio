<?php
/** Full release ZIP boot, without reflected constructors or plugin substitutes. */
declare(strict_types=1);
$wpRoot = $argv[1] ?? '';
$phase = $argv[2] ?? '';
$scenario = $argv[3] ?? 'install';
if (!preg_match('~^/tmp/wpsuite-generations\.[^/]+/wordpress$~D', $wpRoot)) {
    throw new RuntimeException('Only the disposable runner directory is allowed.');
}
$complete = false;
register_shutdown_function(static function () use (&$complete, $scenario, $phase): void {
    if (!$complete) {
        fwrite(STDERR, "Incomplete full-plugin scenario: {$scenario}/{$phase}\n");
        exit(1);
    }
});
$_SERVER['HTTP_HOST'] = 'navigation.test';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/wp-admin/index.php';
$_SERVER['PHP_SELF'] = '/wp-admin/index.php';
define('WP_ADMIN', true);
if ($phase === 'install') define('WP_INSTALLING', true);
require $wpRoot . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/admin.php';
if ($phase === 'install') {
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    wp_install('Generation test', 'generation-admin', 'admin@example.test', false, '', wp_generate_password());
    $complete = true;
    exit;
}
$expect = json_decode(file_get_contents($wpRoot . '/generation-expectations.json'), true, 512, JSON_THROW_ON_ERROR);
if ($phase === 'setup') {
    $plugins = json_decode(file_get_contents($wpRoot . '/generation-plugins.json'), true, 512, JSON_THROW_ON_ERROR);
    foreach ($plugins as $file) {
        if (!file_exists(WP_PLUGIN_DIR . '/' . $file)) throw new RuntimeException('Missing plugin: ' . $file);
    }
    update_option('active_plugins', $plugins);
    $siteSettings = (object) array('workspaceId' => 'fixture-workspace', 'siteId' => 'fixture-site', 'siteKey' => 'fixture-key', 'workspaceApiMode' => 'legacy');
    foreach (array('smartcloud-wpsuite', 'hub-for-wpsuiteio') as $prefix) {
        update_option($prefix . '/site-settings', $siteSettings);
        update_option($prefix . '/top-menu-owner', 'gatey/gatey.php');
        update_option($prefix . '/top-menu-owner/version', $expect['baseline_owner']);
    }
    update_option('gatey', array('fixture' => 'preserve-gatey-settings'));
    $complete = true;
    exit;
}
wp_set_current_user(1);
wp_get_current_user()->add_cap('smartcloud_composer_view_status');
wp_get_current_user()->add_cap('smartcloud_view_content_relations');
$pagenow = 'index.php';
$plugin_page = null;
require ABSPATH . 'wp-admin/menu.php';
$root = 'smartcloud-wpsuite';
$pages = array('gatey', 'smartcloud-ai-kit', 'smartcloud-ai-kit-diagnostics', 'smartcloud-flow', 'smartcloud-static-publisher', 'smartcloud-agent-composer', $root . '-settings');
foreach (array('smartcloud-consent', 'smartcloud-content-relations') as $slug) {
    if (is_plugin_active($slug . '/' . $slug . '.php')) $pages[] = $slug;
}
foreach ($pages as $page) {
    $hook = get_plugin_page_hookname($page, $root);
    if (!isset($_registered_pages[$hook]) || !has_action($hook)) throw new RuntimeException('Missing original callback: ' . $page);
    $plugin_page = $page;
    $pagenow = 'admin.php';
    $parent_file = $root;
    if (!user_can_access_admin_page()) throw new RuntimeException('Original URL denied: ' . $page);
}
$version = defined('SMARTCLOUD_WPSUITE_VERSION') ? SMARTCLOUD_WPSUITE_VERSION : 'missing';
$ownerVersion = get_option($root . '/top-menu-owner/version');
$expectedRuntime = $expect['settled_runtime'];
$validRuntime = $phase === 'first' ? in_array($version, $expect['versions'], true) : $version === $expectedRuntime;
if (!$validRuntime || $ownerVersion !== $expect['owner']) {
    throw new RuntimeException("Owner failed: runtime={$version}, owner={$ownerVersion}, expected runtime={$expectedRuntime}, owner={$expect['owner']}");
}
foreach (array('smartcloud-wpsuite', 'hub-for-wpsuiteio') as $prefix) {
    global $wpdb;
    $site = maybe_unserialize($wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $prefix . '/site-settings')));
    if (!is_object($site) || ($site->workspaceId ?? null) !== 'fixture-workspace' || ($site->siteId ?? null) !== 'fixture-site' || ($site->siteKey ?? null) !== 'fixture-key' || ($site->workspaceApiMode ?? null) !== 'legacy') throw new RuntimeException('Site settings changed: ' . $prefix);
}
if (get_option('gatey') !== array('fixture' => 'preserve-gatey-settings')) throw new RuntimeException('Gatey settings changed');
if ($phase === 'settled' && version_compare($expect['owner'], $expect['baseline_owner'], '>')) {
    if (!class_exists('SmartCloud\\WPSuite\\Hub\\AdminNavigation')) throw new RuntimeException('New navigation was not loaded');
    if (!isset($_registered_pages[get_plugin_page_hookname($root . '-advanced', $root)])) throw new RuntimeException('Advanced is unavailable');
}
printf("PASS %s/%s: runtime=%s owner=%s original-pages=%d\n", $scenario, $phase, $version, $ownerVersion, count($pages));
$complete = true;
