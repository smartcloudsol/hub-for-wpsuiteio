<?php
/** Real WordPress menu/access tests, run only through run-navigation-wordpress.sh. */
declare(strict_types=1);

$wpRoot = $argv[1] ?? '';
$scenario = $argv[2] ?? '';
$completed = false;
register_shutdown_function(static function () use (&$completed, $scenario): void {
    if (!$completed) {
        fwrite(STDERR, "Integration scenario did not finish: {$scenario}\n");
        exit(1);
    }
});
if (!preg_match('~^/tmp/wpsuite-navigation\.[^/]+/wordpress$~D', $wpRoot)) {
    throw new RuntimeException('Only the disposable runner directory is allowed.');
}
$_SERVER['HTTP_HOST'] = 'navigation.test';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/wp-admin/index.php';
$_SERVER['PHP_SELF'] = '/wp-admin/index.php';
define('WP_ADMIN', true);
if (in_array($scenario, array('install', 'network-install'), true)) {
    define('WP_INSTALLING', true);
}
require $wpRoot . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/admin.php';
if ($scenario === 'install') {
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    wp_install('Navigation test', 'navigation-admin', 'admin@example.test', false, '', wp_generate_password());
    echo "Installed disposable WordPress {$GLOBALS['wp_version']}.\n";
    $completed = true;
    exit;
}
if ($scenario === 'network-install') {
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    require_once ABSPATH . 'wp-admin/includes/schema.php';
    foreach ($wpdb->tables('ms_global') as $table => $prefixedTable) {
        $wpdb->$table = $prefixedTable;
    }
    install_network();
    $result = populate_network(1, 'navigation.test', 'admin@example.test', 'Navigation network', '/', false);
    if (is_wp_error($result)) {
        throw new RuntimeException($result->get_error_message());
    }
    update_site_option('menu_items', array('plugins' => 1));
    echo "Installed disposable multisite network.\n";
    $completed = true;
    exit;
}

$checks = 0;
$failures = array();
function nav_assert(bool $condition, string $message): void
{
    global $checks, $failures;
    ++$checks;
    if (!$condition) {
        $failures[] = $message;
        fwrite(STDERR, "FAIL: {$message}\n");
    }
}
function nav_access(string $page): bool
{
    global $plugin_page, $pagenow, $parent_file;
    $previous = array($plugin_page ?? null, $pagenow ?? null, $parent_file ?? null);
    $plugin_page = $page;
    $pagenow = 'admin.php';
    $parent_file = SMARTCLOUD_WPSUITE_CANONICAL_SLUG;
    $allowed = user_can_access_admin_page();
    [$plugin_page, $pagenow, $parent_file] = $previous;
    return $allowed;
}

$repo = dirname(__DIR__, 3);
define('SMARTCLOUD_WPSUITE_CANONICAL_SLUG', 'smartcloud-wpsuite');
define('SMARTCLOUD_WPSUITE_LEGACY_SLUG', 'smartcloud-wpsuiteio');
define('SMARTCLOUD_WPSUITE_PATH', dirname(__DIR__) . '/php/');
define('GATEY_PATH', $repo . '/gatey/');
define('GATEY_SLUG', 'gatey');
define('SMARTCLOUD_AI_KIT_PATH', $repo . '/ai-kit/');
define('SMARTCLOUD_AI_KIT_SLUG', 'smartcloud-ai-kit');
define('SMARTCLOUD_FLOW_PATH', $repo . '/flow/');
define('SMARTCLOUD_FLOW_SLUG', 'smartcloud-flow');
require SMARTCLOUD_WPSUITE_PATH . 'index.php';
require $repo . '/smartcloud-agent-ready-product-family/agent-composer/src/Infrastructure/WordPress/Activation.php';
require $repo . '/wpsuite-private-plugins/content-relations/includes/class-review-access.php';
$sources = array(
    array('gatey/admin/php/admin.php', 'SmartCloud\\WPSuite\\Gatey\\Admin', 'addMenu'),
    array('ai-kit/admin/php/admin.php', 'SmartCloud\\WPSuite\\AiKit\\Admin', 'addMenu'),
    array('flow/admin/php/admin.php', 'SmartCloud\\WPSuite\\Flow\\Admin', 'addMenu'),
    array('static-publisher/admin/php/admin.php', 'SmartCloud\\WPSuite\\StaticPublisher\\Admin\\Admin', 'addMenu'),
    array('smartcloud-agent-ready-product-family/agent-composer/admin/php/admin.php', 'SmartCloud\\AgentComposer\\Admin\\AdminPage', 'menu'),
    array('wpsuite-private-plugins/consent/includes/class-admin.php', 'SmartCloud\\WPSuite\\Consent\\Admin', 'menu'),
    array('wpsuite-private-plugins/content-relations/includes/class-admin.php', 'SmartCloud\\WPSuite\\ContentRelations\\Admin', 'menu'),
);
$composerCap = SmartCloud\AgentComposer\Infrastructure\WordPress\Activation::CAP_VIEW_STATUS;
$reviewCap = SmartCloud\WPSuite\ContentRelations\ReviewAccess::CAPABILITY;
if ($scenario === 'composer') {
    add_role('navigation_composer', 'Composer only', array('read' => true, $composerCap => true));
}
if ($scenario === 'reviewer') {
    add_role('navigation_reviewer', 'Content review only', array('read' => true, $reviewCap => true));
}
$isAdministrator = in_array($scenario, array('administrator', 'old-ai-kit', 'future-ai-kit', 'site-administrator', 'super-administrator'), true);
$role = $isAdministrator ? 'administrator' : (in_array($scenario, array('composer', 'reviewer'), true) ? 'navigation_' . $scenario : $scenario);
$user = wp_insert_user(array('user_login' => 'navigation-' . $scenario, 'user_pass' => wp_generate_password(), 'role' => $role));
nav_assert(is_int($user), 'Test role user created');
wp_set_current_user($user);
if ($isAdministrator) {
    wp_get_current_user()->add_cap($composerCap);
    wp_get_current_user()->add_cap($reviewCap);
}
if ($scenario === 'super-administrator') {
    grant_super_admin($user);
}
if (in_array($scenario, array('site-administrator', 'super-administrator'), true)) {
    nav_assert(is_multisite(), 'Real multisite bootstrapped');
    nav_assert(is_super_admin() === ($scenario === 'super-administrator'), 'Network privilege matches scenario');
}

// Reflection skips unrelated settings migrations/cloud integrations. All menu,
// producer descriptor, hook, permission and projection code is the real source.
$hub = (new ReflectionClass(SmartCloud\WPSuite\Hub\HubAdmin::class))->newInstanceWithoutConstructor();
$navigation = new SmartCloud\WPSuite\Hub\AdminNavigation($hub);
$property = new ReflectionProperty($hub, 'navigation');
$property->setAccessible(true);
$property->setValue($hub, $navigation);
$producers = array();
$reviewAccess = (new ReflectionClass(SmartCloud\WPSuite\ContentRelations\ReviewAccess::class))->newInstanceWithoutConstructor();
add_action('admin_menu', array($reviewAccess, 'menu'), 31);
foreach ($sources as [$file, $class, $menuMethod]) {
    require $repo . '/' . $file;
    nav_assert(str_contains(file_get_contents($repo . '/' . $file), "'smartcloud_wpsuite_admin_capabilities'"), $class . ' hooks the shared descriptor filter');
    $producer = (new ReflectionClass($class))->newInstanceWithoutConstructor();
    $producers[] = $producer;
    if ($scenario !== 'old-ai-kit' || !str_contains($file, 'ai-kit/')) {
        add_filter('smartcloud_wpsuite_admin_capabilities', array($producer, 'registerHubCapabilities'));
    }
    add_action('admin_menu', array($producer, $menuMethod), 30);
}
if ($scenario === 'future-ai-kit') {
    add_filter('smartcloud_wpsuite_admin_capabilities', static function (array $entries): array {
        return array_map(static fn(array $entry): array => $entry['product_id'] === 'smartcloud-ai-kit' ? array_replace($entry, array('schema_version' => 2)) : $entry, $entries);
    }, 20);
}
nav_assert(count(apply_filters('smartcloud_wpsuite_admin_capabilities', array())) === ($scenario === 'old-ai-kit' ? 6 : 8), 'Available producers register expected descriptors');
$root = SMARTCLOUD_WPSUITE_CANONICAL_SLUG;
$oldCallback = static function (): void { echo 'old-generation-still-works'; };
add_action('admin_menu', static function () use ($root, $hub, $oldCallback): void {
    add_menu_page('WP Suite', 'WP Suite', 'manage_options', $root, array($hub, 'renderAdminPage'));
    add_submenu_page($root, 'Platform Settings', 'Platform Settings', 'manage_options', $root . '-settings', array($hub, 'renderAdminPage'));
    add_submenu_page($root, 'Unknown older plugin', 'Unknown older plugin', 'read', 'legacy-unknown', $oldCallback);
}, 10);
$oldHooks = array();
$oldAccess = array();
add_action('admin_menu', static function () use (&$oldHooks, &$oldAccess, $root): void {
    global $_registered_pages, $wp_filter, $submenu;
    foreach ($_registered_pages as $hook => $_) {
        if (isset($wp_filter[$hook])) {
            $oldHooks[$hook] = $wp_filter[$hook]->callbacks;
        }
    }
    foreach ($submenu[$root] ?? array() as $item) {
        if (!str_contains($item[2], '://')) {
            $oldAccess[$item[2]] = nav_access($item[2]);
        }
    }
}, 100);
add_action('admin_menu', array($hub, 'mergeLegacyAdminMenu'), PHP_INT_MAX);
add_action('admin_menu', array($navigation, 'registerMenus'), PHP_INT_MAX);
$pagenow = 'index.php';
$plugin_page = null;
// WordPress itself runs admin_menu, filters capability rows and builds no_priv.
require ABSPATH . 'wp-admin/menu.php';
foreach ($oldHooks as $hook => $callbacks) {
    nav_assert(isset($_registered_pages[$hook]), 'Old hook remains registered: ' . $hook);
    nav_assert($wp_filter[$hook]->callbacks === $callbacks, 'Old callback unchanged: ' . $hook);
}
foreach ($oldAccess as $slug => $allowed) {
    nav_assert(nav_access($slug) === $allowed, 'Old direct access unchanged: ' . $slug);
}
nav_assert(nav_access('legacy-unknown'), 'Unknown old menu direct URL remains accessible');
ob_start();
do_action(get_plugin_page_hookname('legacy-unknown', $root));
nav_assert(ob_get_clean() === 'old-generation-still-works', 'Old generation callback executes');
$rows = array_column($submenu[$root] ?? array(), 2);
nav_assert(in_array('legacy-unknown', $rows, true), 'Unknown old menu remains visible');
foreach (array('consent', 'content-relations') as $privateId) {
    $privateSlug = $root . '-capability-' . $privateId;
    $privateRows = array_values(array_filter($submenu[$root] ?? array(), static fn(array $row): bool => $row[2] === $privateSlug));
    foreach ($privateRows as $privateRow) {
        nav_assert(str_contains($privateRow[4] ?? '', 'wpsuite-secondary-destination'), 'Private installed tool hidden from sidebar: ' . $privateId);
        nav_assert(nav_access($privateSlug), 'Private tool direct route accessible: ' . $privateId);
        nav_assert($navigation->highlightSubmenu($privateSlug) === $privateSlug, 'Private tool retains its own destination: ' . $privateId);
    }
}
$before = $submenu;
$navigation->registerMenus();
nav_assert($submenu === $before, 'Repeated registration creates no duplicates');
$bootstrap = $navigation->bootstrap($root);
$ids = array_column($bootstrap['capabilities'], 'id');
$expected = match ($scenario) {
    'administrator', 'site-administrator', 'super-administrator' => array('answers', 'ai-tools', 'ai-editing', 'forms-workflows', 'login-access', 'static-publishing', 'consent', 'content-relations'),
    'old-ai-kit', 'future-ai-kit' => array('ai-editing', 'forms-workflows', 'login-access', 'static-publishing', 'consent', 'content-relations'),
    'editor' => array('forms-workflows', 'login-access'),
    'composer' => array('ai-editing'),
    'reviewer' => array('content-relations'),
    default => array(),
};
nav_assert($ids === $expected, 'Role-filtered capability IDs: ' . $scenario . ' ' . wp_json_encode($ids));
foreach ($bootstrap['capabilities'] as $tool) {
    nav_assert(($tool['show_in_overview'] ?? null) === ($tool['id'] !== 'ai-tools'), 'Only the AI Tools compatibility alias is omitted from product cards');
    if (in_array($tool['id'], array('login-access', 'forms-workflows', 'ai-editing'), true)) {
        $ownsDetail = $tool['id'] === 'ai-editing' ? ($isAdministrator || $scenario === 'composer') : $isAdministrator;
        nav_assert(($tool['has_details'] ?? null) === $ownsDetail, 'Detail mounting retains original product permission: ' . $tool['id']);
        if ($ownsDetail) {
            ob_start(); do_action(get_plugin_page_hookname($root . '-capability-' . $tool['id'], $root)); $integratedHtml = ob_get_clean();
            nav_assert(str_contains($integratedHtml, 'id="wpsuite-product-details"') && str_contains($integratedHtml, 'data-wpsuite-product="' . $tool['id'] . '"') && str_contains($integratedHtml, ' hidden>'), 'Native detail is isolated in a hidden product wrapper: ' . $tool['id']);
            $mount = array('login-access' => 'smartcloud-gatey-admin', 'forms-workflows' => 'smartcloud-flow-admin', 'ai-editing' => 'smartcloud-composer-admin')[$tool['id']];
            nav_assert(str_contains($integratedHtml, 'id="' . $mount . '"'), 'Existing native callback renders inside wrapper: ' . $tool['id']);
        }
    }
}

if ($ids) {
    nav_assert(nav_access($root), 'Permitted nonadmin can open root after WordPress menu pruning');
    nav_assert(!isset($_wp_menu_nopriv[$root]), 'Root no_priv cleared for permitted user');
    nav_assert(!isset($_wp_submenu_nopriv[$root][$root]), 'Root submenu no_priv cleared');
}
foreach ($expected as $id) {
    nav_assert(nav_access($root . '-capability-' . $id), 'Projected capability page accessible: ' . $id);
    nav_assert($navigation->hasHook(get_plugin_page_hookname($root . '-capability-' . $id, $root)), 'Projected page is recognized for assets: ' . $id);
}
foreach (array('gatey', 'smartcloud-ai-kit', 'smartcloud-ai-kit-diagnostics', 'smartcloud-flow', 'smartcloud-static-publisher', 'smartcloud-consent', 'smartcloud-content-relations') as $settingsSlug) {
    nav_assert(nav_access($settingsSlug) === $isAdministrator, 'Original settings permission preserved: ' . $settingsSlug);
}
nav_assert(nav_access('smartcloud-agent-composer') === ($isAdministrator || $scenario === 'composer'), 'Original Composer capability permission preserved');
nav_assert(nav_access('smartcloud-content-relations-review') === ($isAdministrator || $scenario === 'reviewer'), 'Original Content Review capability permission preserved');
$relationCapabilities = array_values(array_filter($bootstrap['capabilities'], static fn(array $entry): bool => $entry['id'] === 'content-relations'));
if ($isAdministrator || $scenario === 'reviewer') {
    nav_assert(in_array(admin_url('admin.php?page=smartcloud-content-relations-review'), array_column($relationCapabilities[0]['advanced_links'], 'url'), true), 'Advanced exposes Content Review with review permission');
}
if (!$isAdministrator) {
    nav_assert(!$bootstrap['can_manage_connection'] && !$bootstrap['platform_links'], 'Nonadmin receives no connection settings link');
    nav_assert(!nav_access($root . '-settings'), 'Nonadmin direct settings URL stays denied');
    foreach ($bootstrap['capabilities'] as $capability) {
        $links = array_merge(array($capability['primary']), $capability['advanced_links'], $capability['quick_links']);
        foreach ($links as $link) {
            nav_assert(!str_contains($link['url'], 'admin.php?page=gatey') && !str_contains($link['url'], 'admin.php?page=smartcloud-flow'), 'Settings links filtered from editor destinations');
            nav_assert($link['url'] !== admin_url('admin.php?page=smartcloud-content-relations'), 'Content Relations settings are never exposed to nonadmins');
        }
    }
}
if (in_array($scenario, array('old-ai-kit', 'future-ai-kit'), true)) {
    foreach ($submenu[$root] as $row) {
        if (in_array($row[2], array('smartcloud-ai-kit', 'smartcloud-ai-kit-diagnostics'), true)) {
            nav_assert(!str_contains($row[4] ?? '', 'wpsuite-legacy-destination'), 'Unsupported or missing descriptor preserves the old AI Kit menu: ' . $row[2]);
        }
    }
}
if ($isAdministrator) {
    $advancedUrls = array_column($bootstrap['platform_links'], 'url');
    foreach ($bootstrap['capabilities'] as $capability) {
        $advancedUrls = array_merge($advancedUrls, array_column($capability['advanced_links'], 'url'));
    }
    foreach ($submenu[$root] as $row) {
        if (str_contains($row[4] ?? '', 'wpsuite-legacy-destination')) {
            $target = str_contains($row[2], '://') ? html_entity_decode($row[2], ENT_QUOTES, 'UTF-8') : admin_url('admin.php?page=' . $row[2]);
            if ($row[2] === $root . '-advanced') {
                nav_assert(nav_access($root . '-advanced') && in_array(admin_url('admin.php?page=' . $root . '-settings'), $advancedUrls, true), 'Retired Advanced alias remains accessible with Platform Settings replacement');
                nav_assert(has_action('load-' . get_plugin_page_hookname($root . '-advanced', $root)) !== false, 'Retired Advanced alias redirects through its load hook');
            } else {
                nav_assert(in_array($target, $advancedUrls, true), 'Hidden destination remains linked from its product resources: ' . $row[2]);
            }
        }
    }
}
$_GET['page'] = $root;
ob_start();
$hub->renderAdminPage();
$html = ob_get_clean();
nav_assert(str_contains($html, 'data-navigation='), 'Hub renders real navigation bootstrap');
nav_assert(!str_contains($html, 'siteKey'), 'Bootstrap does not expose connection settings');

// Exercise WordPress' actual menu HTML, not just the PHP submenu array.
$parent_file = $root;
$submenu_file = $root;
ob_start();
require ABSPATH . 'wp-admin/menu-header.php';
$menuHtml = ob_get_clean();
$tags = new WP_HTML_Tag_Processor($menuHtml);
$hiddenRows = 0;
$currentHidden = false;
while ($tags->next_tag()) {
    if ($tags->get_tag() === 'LI') {
        $currentHidden = $tags->has_class('wpsuite-legacy-destination');
        $hiddenRows += (int) $currentHidden;
    }
    if ($tags->get_tag() === 'A' && str_contains((string) $tags->get_attribute('href'), 'page=legacy-unknown')) {
        nav_assert(!$currentHidden, 'Unknown old plugin is not hidden in actual menu HTML');
    }
}
$expectedHidden = count(array_filter($submenu[$root] ?? array(), static fn(array $row): bool => str_contains($row[4] ?? '', 'wpsuite-legacy-destination')));
nav_assert($hiddenRows === $expectedHidden, 'WordPress emits the hidden legacy row classes');
nav_assert(in_array($scenario, array('subscriber', 'reviewer'), true) ? $hiddenRows === 0 : $hiddenRows > 0, 'Only represented legacy destinations are visually hidden');
if ($ids) {
    ob_start();
    $navigation->renderMenuStyles();
    $menuCss = ob_get_clean();
    nav_assert(str_contains($menuCss, '#adminmenu .wpsuite-legacy-destination{display:none!important}'), 'Legacy navigation hiding is scoped to the menu');
}

// Discovery is a fixed public catalog. Test real get_plugins metadata and active
// state without loading plugins or contacting the directory.
$catalogIds = array_column($bootstrap['discovery'], 'id');
nav_assert(!in_array('consent', $catalogIds, true) && !in_array('content-relations', $catalogIds, true), 'Private plugins never advertised');
$emptyNavigation = new SmartCloud\WPSuite\Hub\AdminNavigation($hub);
$discovery = $emptyNavigation->bootstrap($root)['discovery'];
nav_assert(count($discovery) === 5, 'Five public products discoverable when absent without a duplicate AI Tools install card');
foreach ($discovery as $card) {
    nav_assert($card['state'] === 'not_installed', 'Absent plugin state');
    if (current_user_can('install_plugins')) {
        nav_assert(str_contains($card['action']['url'] ?? '', 'plugin-install.php?tab=plugin-information&plugin='), 'Install CTA uses native WordPress review flow');
        nav_assert(!str_contains($card['action']['url'], 'action=install'), 'Discovery never installs without WordPress confirmation');
        if ($card['id'] === 'answers') {
            nav_assert($card['action']['label'] === 'Install AI-Kit for Answers' && str_ends_with($card['action']['url'], 'plugin=smartcloud-ai-kit'), 'Answers installs the public AI-Kit listing');
        }
    } else {
        nav_assert($card['action'] === null, 'No install CTA without install capability');
    }
}
$fixtureDir = WP_PLUGIN_DIR . '/renamed-ai-kit';
wp_mkdir_p($fixtureDir);
file_put_contents($fixtureDir . '/plugin.php', "<?php\n/*\nPlugin Name: Navigation fixture\nText Domain: smartcloud-ai-kit\n*/\n");
wp_clean_plugins_cache();
$inactive = $emptyNavigation->bootstrap($root)['discovery'];
$aiCards = array_values(array_filter($inactive, static fn(array $card): bool => in_array($card['id'], array('answers', 'ai-tools'), true)));
nav_assert(count($aiCards) === 1 && $aiCards[0]['state'] === 'inactive', 'Alternate folder recognized by exact text domain');
nav_assert(current_user_can('activate_plugins') ? str_ends_with($aiCards[0]['action']['url'] ?? '', 'plugins.php') : $aiCards[0]['action'] === null, 'Inactive action respects activation capability');
if (is_multisite()) {
    update_site_option('active_sitewide_plugins', array('renamed-ai-kit/plugin.php' => time()));
    $networkActive = array_column($emptyNavigation->bootstrap($root)['discovery'], 'id');
    nav_assert(!in_array('answers', $networkActive, true) && !in_array('ai-tools', $networkActive, true), 'Network-active plugin is never advertised as missing');
    update_site_option('active_sitewide_plugins', array());
}
update_option('active_plugins', array('renamed-ai-kit/plugin.php'));
$active = array_column($emptyNavigation->bootstrap($root)['discovery'], 'id');
nav_assert(!in_array('answers', $active, true) && !in_array('ai-tools', $active, true), 'Active old plugin is never advertised as missing');
$canonicalDir = WP_PLUGIN_DIR . '/smartcloud-ai-kit';
wp_mkdir_p($canonicalDir);
file_put_contents($canonicalDir . '/smartcloud-ai-kit.php', "<?php\n/*\nPlugin Name: Inactive duplicate\nText Domain: smartcloud-ai-kit\n*/\n");
wp_clean_plugins_cache();
$duplicate = array_column($emptyNavigation->bootstrap($root)['discovery'], 'id');
nav_assert(!in_array('answers', $duplicate, true) && !in_array('ai-tools', $duplicate, true), 'Inactive canonical duplicate never conceals an active alternate installation');
update_option('active_plugins', array());
unlink($canonicalDir . '/smartcloud-ai-kit.php');
rmdir($canonicalDir);
unlink($fixtureDir . '/plugin.php');
rmdir($fixtureDir);
wp_clean_plugins_cache();

if ($isAdministrator) {
    $valid = $producers[0]->registerHubCapabilities(array())[0];
    nav_assert(count($navigation->resolve(array($valid, $valid))) === 1, 'Duplicate identical descriptors deduplicate');
    nav_assert($navigation->resolve(array($valid, array_replace($valid, array('label' => 'Conflicting owner')))) === array(), 'Conflicting descriptors rejected');
    foreach (array(
        array('schema_version' => 2), array('id' => '../bad'), array('primary_url' => 'https://outside.example/admin.php?page=gatey'),
        array('primary_url' => admin_url('admin.php?page=missing-destination'), 'quick_links' => array(), 'advanced_links' => array()),
        array('primary_url' => admin_url('edit.php?post_type=missing_post_type'), 'quick_links' => array(), 'advanced_links' => array()),
        array('primary_url' => admin_url('post-new.php?post_type=missing_post_type'), 'quick_links' => array(), 'advanced_links' => array()),
        array('primary_url' => admin_url('admin.php?page=gatey&action=delete')),
        array('primary_url' => admin_url('admin.php?page[]=gatey')), array('primary_url' => admin_url('plugins.php?action=activate')),
    ) as $invalid) {
        nav_assert($navigation->resolve(array(array_replace($valid, $invalid))) === array(), 'Malformed/unsafe/missing destination rejected: ' . wp_json_encode($invalid));
    }
    nav_assert($navigation->resolve(array(null, false, 'invalid')) === array(), 'Non-array descriptors rejected');
}
if ($failures) {
    fwrite(STDERR, "FAILED {$scenario}: " . count($failures) . " of {$checks} assertions.\n");
    exit(1);
}
echo "PASS {$scenario}: {$checks} real WordPress integration assertions.\n";
$completed = true;
