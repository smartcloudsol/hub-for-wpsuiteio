<?php

declare(strict_types=1);

// Pure registry contract checks; real WordPress menu access has a separate gate.
namespace SmartCloud\WPSuite\Hub {
    class HubAdmin { public function renderAdminPage(): void {} }
}

namespace {
    define('ABSPATH', __DIR__ . '/');
    define('SMARTCLOUD_WPSUITE_CANONICAL_SLUG', 'smartcloud-wpsuite');
    $permissions = array('read', 'manage_options', 'edit_posts', 'install_plugins', 'activate_plugins');
    $installedPlugins = array();
    $activePlugins = array();
    $fileMods = true;
    $descriptors = array();
    $menu = array(array('SmartCloud', 'manage_options', 'smartcloud-wpsuite'));
    $submenu = array();
    $_registered_pages = array();
    $_wp_menu_nopriv = array();
    $_wp_submenu_nopriv = array();
    function __(string $text, string $domain = ''): string { return $text; }
    function admin_url(string $path = ''): string { return 'https://example.test/subsite/wp-admin/' . $path; }
    function self_admin_url(string $path = ''): string { return admin_url($path); }
    function rest_url(string $path = ''): string { return 'https://example.test/subsite/wp-json/' . $path; }
    function wp_create_nonce(string $action): string { return 'test-nonce'; }
    function wp_unslash(string $value): string { return stripslashes($value); }
    function wp_parse_url(string $url): array|false { return parse_url($url); }
    function sanitize_text_field(string $text): string { return strip_tags($text); }
    function current_user_can(string $capability): bool { return in_array($capability, $GLOBALS['permissions'], true); }
    function wp_is_file_mod_allowed(string $context): bool { return $GLOBALS['fileMods']; }
    function get_post_type_object(string $type): ?object {
        return in_array($type, array('post', 'wp_block'), true)
            ? (object) array('show_ui' => true, 'cap' => (object) array('edit_posts' => 'edit_posts', 'create_posts' => 'edit_posts'))
            : null;
    }
    function get_plugins(): array { return $GLOBALS['installedPlugins']; }
    function is_plugin_active(string $file): bool { return in_array($file, $GLOBALS['activePlugins'], true); }
    function is_plugin_active_for_network(string $file): bool { return false; }
    function apply_filters(string $hook, array $value): array { return $GLOBALS['descriptors']; }
    function add_filter(string $hook, mixed $callback, int $priority = 10): void {}
    function add_action(string $hook, mixed $callback, int $priority = 10): void {}
    function get_plugin_page_hookname(string $page, string $parent): string { return $parent . '_page_' . $page; }
    function add_submenu_page(string $parent, string $title, string $label, string $cap, string $slug, mixed $callback): string {
        $GLOBALS['submenu'][$parent][] = array($label, $cap, $slug, $title);
        $hook = get_plugin_page_hookname($slug, $parent);
        $GLOBALS['_registered_pages'][$hook] = true;
        return $hook;
    }
    function check(bool $ok, string $message): void {
        if (!$ok) { throw new \RuntimeException($message); }
    }
    function descriptor(string $id = 'login-access'): array {
        return array(
            'schema_version' => 1, 'id' => $id, 'product_id' => 'gatey',
            'label' => 'Login & Access', 'product' => 'Gatey', 'order' => 40,
            'description' => 'Sign in.', 'primary_url' => admin_url('admin.php?page=gatey'),
            'primary_label' => 'Configure login', 'required_capability' => 'manage_options',
            'advanced_links' => array(array('label' => 'Settings', 'url' => admin_url('admin.php?page=gatey'))),
            'quick_links' => array(array('label' => 'Patterns', 'url' => admin_url('edit.php?post_type=wp_block&s=gatey'), 'required_capability' => 'edit_posts')),
            'legacy_menu_slugs' => array('gatey', admin_url('edit.php?post_type=wp_block&s=gatey')),
        );
    }
    require dirname(__DIR__) . '/php/navigation.php';
    $nav = new \SmartCloud\WPSuite\Hub\AdminNavigation(new \SmartCloud\WPSuite\Hub\HubAdmin());
    $_registered_pages[get_plugin_page_hookname('gatey', 'smartcloud-wpsuite')] = true;
    check(count($nav->resolve(array(descriptor(), descriptor()))) === 1, 'Identical registrations must deduplicate');
    $conflict = descriptor(); $conflict['product_id'] = 'other-plugin';
    check($nav->resolve(array(descriptor(), $conflict)) === array(), 'Conflicting owners must retain legacy fallback');
    $invalid = descriptor(); $invalid['schema_version'] = 2;
    check($nav->resolve(array($invalid)) === array(), 'Unknown descriptor version must be ignored');
    $unrelatedDetail = descriptor();
    $unrelatedDetail['detail_page'] = 'another-plugin';
    $unrelatedDetail['detail_enqueue'] = static function (): void {};
    check($nav->resolve(array($unrelatedDetail))[0]['detail_page'] === null, 'Inline detail must belong to the declared primary page');
    $deepLink = descriptor();
    $deepLink['advanced_links'][] = array('label' => 'API settings', 'url' => admin_url('admin.php?page=gatey&section=api-settings'));
    check(count($nav->resolve(array($deepLink))[0]['advanced_links']) === 2, 'Safe subsection destinations must remain visible');
    foreach (array('https://evil.test/wp-admin/admin.php?page=gatey', 'javascript:alert(1)', admin_url('admin.php?page=gatey&action=delete'), admin_url('admin.php?page=gatey&section[]=general'), admin_url('admin.php?page=gatey&section=..%2Fdelete'), admin_url('../admin.php?page=gatey'), admin_url('admin.php?page[]=gatey'), admin_url('update.php?action=install-plugin')) as $badUrl) {
        $invalid = descriptor(); $invalid['primary_url'] = $badUrl;
        check($nav->resolve(array($invalid)) === array(), 'Invalid navigation destination accepted: ' . $badUrl);
    }
    $invalid = descriptor(); $invalid['quick_links'] = array(null, 12, array('label' => 'Bad', 'url' => 'javascript:bad'));
    check(count($nav->resolve(array($invalid))) === 1, 'Bad optional links must not break valid primary');
    $permissions = array('read', 'edit_posts');
    $resolved = $nav->resolve(array(descriptor()));
    check(count($resolved) === 1 && $resolved[0]['primary']['label'] === 'Patterns', 'Editors need their accessible Patterns fallback');
    check($resolved[0]['advanced_links'] === array(), 'Editors must not receive admin settings');
    check(!in_array('gatey', $resolved[0]['legacy_menu_slugs'], true), 'Cannot hide a destination with no accessible equivalent');
    $permissions = array('read');
    check($nav->resolve(array(descriptor())) === array(), 'No accessible link means no capability');
    $permissions = array('read', 'manage_options', 'install_plugins', 'activate_plugins');
    $missing = descriptor(); $missing['primary_url'] = admin_url('admin.php?page=missing'); $missing['advanced_links'] = array(); $missing['quick_links'] = array();
    check($nav->resolve(array($missing)) === array(), 'A missing target must not create a broken capability');
    $missing['primary_url'] = admin_url('edit.php?post_type=not_registered');
    check($nav->resolve(array($missing)) === array(), 'An unknown post type must not create a broken capability');

    $submenu['smartcloud-wpsuite'] = array(
        array('Connect', 'manage_options', 'smartcloud-wpsuite'),
        array('Settings', 'manage_options', 'smartcloud-wpsuite-settings'),
        array('Gatey', 'manage_options', 'gatey'),
        array('Old plugin', 'manage_options', 'untouched-old-plugin'),
    );
    $hidden = descriptor('private-tool'); $hidden['show_in_menu'] = false;
    $descriptors = array(descriptor(), $hidden);
    $nav->registerMenus();
    $before = $submenu;
    $nav->registerMenus();
    check($submenu === $before, 'Repeated registration must be idempotent');
    $slugs = array_column($submenu['smartcloud-wpsuite'], 2);
    check(in_array('untouched-old-plugin', $slugs, true), 'Unknown legacy plugin must remain');
    $legacyRow = $submenu['smartcloud-wpsuite'][array_search('gatey', $slugs, true)];
    check(str_contains($legacyRow[4] ?? '', 'wpsuite-legacy-destination'), 'Declared legacy menu should be visually hidden');
    check($legacyRow[1] === 'manage_options', 'Retained legacy routing must preserve its capability');
    check(isset($_registered_pages[get_plugin_page_hookname('gatey', 'smartcloud-wpsuite')]), 'Legacy route remains registered');
    check(end($slugs) === 'smartcloud-wpsuite-settings', 'Platform Settings is last');
    $privateRow = $submenu['smartcloud-wpsuite'][array_search('smartcloud-wpsuite-capability-private-tool', $slugs, true)];
    check(str_contains($privateRow[4] ?? '', 'wpsuite-secondary-destination'), 'Private tool hidden from primary menu');
    check(isset($_registered_pages[get_plugin_page_hookname('smartcloud-wpsuite-capability-private-tool', 'smartcloud-wpsuite')]), 'Hidden tool keeps its route');
    check($nav->highlightSubmenu('smartcloud-wpsuite-capability-private-tool') === 'smartcloud-wpsuite-capability-private-tool', 'Hidden tool keeps its own destination');
    check(count($nav->bootstrap('smartcloud-wpsuite')['capabilities']) === 2, 'Hidden installed tool keeps Overview card');
    check($nav->highlightSubmenu('gatey') === 'smartcloud-wpsuite-capability-login-access', 'Detailed plugin page highlights its product');
    $GLOBALS['pagenow'] = 'edit.php';
    $_GET = array('post_type' => 'wp_block', 's' => 'gatey');
    // This user has no edit_posts permission, so Patterns is intentionally not mapped.
    check($nav->highlightParent('edit.php') === 'edit.php', 'Inaccessible contextual tools do not take over native menus');
    $_GET = array();
    $bootstrap = $nav->bootstrap('smartcloud-wpsuite');
    check($bootstrap['can_manage_connection'] === true, 'Admins retain connection UI');
    check(count($bootstrap['discovery']) === 4, 'Active Gatey capability is not advertised for install');
    check(!str_contains(json_encode($bootstrap), 'siteKey'), 'Navigation contains no credentials');
    $aiTools = array_values(array_filter($bootstrap['discovery'], static fn(array $entry): bool => $entry['id'] === 'answers'))[0];
    check($aiTools['action']['label'] === 'Install AI-Kit for Answers', 'Answers gets one AI-Kit install entry');
    check(str_contains($aiTools['action']['url'], 'plugin-install.php?tab=plugin-information&plugin=smartcloud-ai-kit'), 'Install entry uses native WordPress review page');
    check(!array_intersect(array('consent', 'content-relations'), array_column($bootstrap['discovery'], 'id')), 'Absent private plugins must never appear in discovery or install cards');
    $installedPlugins['smartcloud-ai-kit/smartcloud-ai-kit.php'] = array('TextDomain' => 'smartcloud-ai-kit');
    $bootstrap = $nav->bootstrap('smartcloud-wpsuite');
    $aiTools = array_values(array_filter($bootstrap['discovery'], static fn(array $entry): bool => $entry['id'] === 'answers'))[0];
    check($aiTools['state'] === 'inactive' && str_ends_with($aiTools['action']['url'], 'plugins.php'), 'Inactive plugins use management, not reinstallation');
    $installedPlugins['another-folder/ai-kit.php'] = array('TextDomain' => 'smartcloud-ai-kit');
    $activePlugins[] = 'another-folder/ai-kit.php';
    check(count($nav->bootstrap('smartcloud-wpsuite')['discovery']) === 3, 'An active alternate copy overrides an inactive canonical copy');
    $activePlugins = array();
    $activePlugins[] = 'smartcloud-ai-kit/smartcloud-ai-kit.php';
    check(count($nav->bootstrap('smartcloud-wpsuite')['discovery']) === 3, 'Active old plugin cannot be advertised as missing');
    $fileMods = false;
    foreach ($nav->bootstrap('smartcloud-wpsuite')['discovery'] as $card) {
        check($card['action'] === null, 'Disabled file changes must suppress install actions');
    }
    check($nav->bootstrap('smartcloud-wpsuite-settings') === null, 'Legacy settings keep separate mount');
    echo "Admin navigation contract checks passed.\n";
}
