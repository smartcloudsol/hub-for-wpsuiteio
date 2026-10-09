<?php

namespace SmartCloud\WPSuite\Hub;

if (!defined('ABSPATH')) {
    exit;
}
require_once __DIR__ . '/capability-surfaces.php';
require_once __DIR__ . '/configuration-reset.php';
require_once __DIR__ . '/admin-top-navigation.php';

/**
 * Admin-only navigation. Product callbacks, storage and runtime stay plugin-owned.
 * V1 descriptors are additive: older hubs can ignore the WordPress filter.
 */
final class AdminNavigation
{
    private array $capabilities = array();
    private array $hooks = array();
    private array $legacyDestinations = array();
    private bool $registered = false;
    private array $advancedUrls = array();
    private array $nativeHooks = array();
    private array $surfaceHooks = array();
    private array $detailHooks = array();

    public function __construct(private HubAdmin $hub)
    {
        $surfaces = new CapabilitySurfaces();
        add_action('rest_api_init', array($surfaces, 'registerRoutes'));
        add_action('rest_api_init', array(new ConfigurationReset(), 'registerRoutes'));
    }

    public function registerMenus(): void
    {
        if ($this->registered) {
            return;
        }
        $this->registered = true;
        $parent = SMARTCLOUD_WPSUITE_CANONICAL_SLUG;
        $descriptors = apply_filters('smartcloud_wpsuite_admin_capabilities', array());
        $this->capabilities = $this->resolve(is_array($descriptors) ? $descriptors : array());

        // Opening the navigation never grants access to connection/settings data.
        if (!current_user_can('read') || (!$this->capabilities && !current_user_can('manage_options'))) {
            return;
        }

        global $menu, $submenu, $_wp_menu_nopriv, $_wp_submenu_nopriv;
        // The old loaders register the root as manage_options. Keep their hook
        // and callback for admins; add a filtered root only for other permitted users.
        foreach ($menu as &$item) {
            if (($item[2] ?? '') === $parent) {
                $item[1] = 'read';
            }
        }
        unset($item);
        unset($_wp_menu_nopriv[$parent], $_wp_submenu_nopriv[$parent][$parent]);
        if (!current_user_can('manage_options')) {
            $this->addPage($parent, __('Overview', 'smartcloud-wpsuite'));
        }
        foreach ($submenu[$parent] ?? array() as $index => $item) {
            if (($item[2] ?? '') === $parent) {
                $submenu[$parent][$index][0] = __('Overview', 'smartcloud-wpsuite');
                $submenu[$parent][$index][1] = 'read';
                $submenu[$parent][$index][3] = __('WP Suite Overview', 'smartcloud-wpsuite');
            }
        }

        foreach ($this->capabilities as $entry) {
            $slug = $this->capabilitySlug($entry['id']);
            $this->addPage($slug, $entry['label'], $entry);
            if (!$entry['show_in_menu'] || ($entry['id'] === 'ai-tools' && in_array('answers', array_column($this->capabilities, 'id'), true))) {
                $this->hideMenuRow($slug, 'wpsuite-secondary-destination');
                $this->legacyDestinations[$slug] = $slug;
            }
            foreach ($entry['advanced_links'] as $link) {
                $this->advancedUrls[] = $link['url'];
                $query = array();
                parse_str(wp_parse_url($link['url'])['query'] ?? '', $query);
                if (isset($query['page'])) {
                    $this->legacyDestinations[$query['page']] ??= $slug;
                }
            }
            foreach ($entry['legacy_menu_slugs'] as $legacySlug) {
                // Hide navigation only; do not unregister callbacks or change hook suffixes.
                $this->hideMenuRow($legacySlug);
                $this->legacyDestinations[$legacySlug] ??= $slug;
            }
        }
        if (current_user_can('manage_options')) {
            $this->addPage($parent . '-advanced', __('Platform Settings', 'smartcloud-wpsuite'));
            $this->hideMenuRow($parent . '-advanced');
            add_action('load-' . get_plugin_page_hookname($parent . '-advanced', $parent), static function () use ($parent): void {
                $args = array('page' => $parent . '-settings');
                if (isset($_GET['section']) && is_string($_GET['section'])) { $args['section'] = sanitize_key(wp_unslash($_GET['section'])); }
                wp_safe_redirect(add_query_arg($args, admin_url('admin.php')));
                exit;
            });
            $this->legacyDestinations[$parent . '-advanced'] = $parent . '-settings';
            $this->advancedUrls[] = admin_url('admin.php?page=' . $parent . '-settings');
            foreach ($submenu[$parent] ?? array() as $index => $item) {
                if (($item[2] ?? '') === $parent . '-settings') {
                    $submenu[$parent][$index][0] = __('Platform Settings', 'smartcloud-wpsuite');
                    $submenu[$parent][$index][3] = __('Platform Settings', 'smartcloud-wpsuite');
                }
            }
        }

        if (in_array('answers', array_column($this->capabilities, 'id'), true)) {
            $aliasHook = get_plugin_page_hookname($this->capabilitySlug('ai-tools'), $parent);
            add_action('load-' . $aliasHook, function () use ($parent): void {
                wp_safe_redirect(admin_url('admin.php?page=' . $parent . '-capability-answers&panel=summary&tools=1'));
                exit;
            });
        }
        // Only reorder our own entries. Unknown old-generation menus are retained.
        $order = array($parent);
        foreach ($this->capabilities as $entry) {
            $order[] = $this->capabilitySlug($entry['id']);
        }
        $rank = array_flip($order);
        $advanced = $parent . '-settings';
        $rows = $submenu[$parent] ?? array();
        usort($rows, static function (array $a, array $b) use ($rank, $advanced): int {
            $aRank = ($a[2] ?? '') === $advanced ? PHP_INT_MAX : ($rank[$a[2] ?? ''] ?? 1000);
            $bRank = ($b[2] ?? '') === $advanced ? PHP_INT_MAX : ($rank[$b[2] ?? ''] ?? 1000);
            return $aRank <=> $bRank;
        });
        $submenu[$parent] = $rows;
        add_filter('submenu_file', array($this, 'highlightSubmenu'), PHP_INT_MAX);
        add_filter('parent_file', array($this, 'highlightParent'), PHP_INT_MAX);
        add_action('admin_head', array($this, 'renderMenuStyles'));
        add_action('admin_enqueue_scripts', array($this, 'enqueueNative'));
        new AdminTopNavigation($this);
    }

    private function addPage(string $slug, string $label, ?array $entry = null): void
    {
        $originalHook = null;
        if (($entry['native_surface'] ?? false) && isset($entry['primary']['url'])) {
            $query = array();
            parse_str(wp_parse_url($entry['primary']['url'])['query'] ?? '', $query);
            if (isset($query['page'])) {
                $originalHook = get_plugin_page_hookname($query['page'], SMARTCLOUD_WPSUITE_CANONICAL_SLUG);
            }
        }
        $detailHook = null;
        if (!empty($entry['detail_page']) && is_callable($entry['detail_enqueue']) && current_user_can($entry['required_capability'])) {
            $candidate = get_plugin_page_hookname($entry['detail_page'], SMARTCLOUD_WPSUITE_CANONICAL_SLUG);
            if (has_action($candidate)) { $detailHook = $candidate; }
        }
        $callback = $originalHook !== null ? static function () use ($originalHook, $entry): void {
            if ($entry['has_reset'] && current_user_can('manage_options') && current_user_can($entry['required_capability'])) {
                echo '<div id="wpsuite-config-reset" data-reset-url="' . esc_url(rest_url('smartcloud-wpsuite/v1/admin-resets/' . $entry['id'])) . '" data-rest-nonce="' . esc_attr(wp_create_nonce('wp_rest')) . '"></div>';
            }
            do_action($originalHook);
        } : array($this->hub, 'renderAdminPage');
        if ($detailHook !== null) {
            $callback = function () use ($detailHook, $entry): void {
                $this->hub->renderAdminPage();
                echo '<section id="wpsuite-product-details" data-wpsuite-product="' . esc_attr($entry['id']) . '" aria-label="' . esc_attr($entry['label']) . '" hidden>';
                do_action($detailHook);
                echo '</section>';
            };
            add_action('load-' . $detailHook, function () use ($slug): void {
                $args = array('page' => $slug, 'panel' => 'details');
                foreach (array('section', 'aikit-page') as $key) {
                    if (isset($_GET[$key]) && is_string($_GET[$key])) { $args[$key] = sanitize_key(wp_unslash($_GET[$key])); }
                }
                wp_safe_redirect(add_query_arg($args, admin_url('admin.php')));
                exit;
            });
        }
        $hook = add_submenu_page(
            SMARTCLOUD_WPSUITE_CANONICAL_SLUG,
            $label,
            $label,
            'read',
            $slug,
            $callback
        );
        if (is_string($hook)) {
            $this->hooks[$hook] = $slug;
            if ($detailHook !== null) { $this->detailHooks[$hook] = array('hook' => $detailHook, 'enqueue' => $entry['detail_enqueue']); }
            if (!empty($entry['surface_extension'])) { $this->surfaceHooks[$hook] = $entry['surface_enqueue']; }
            if ($originalHook !== null) {
                $this->nativeHooks[$hook] = array('hook' => $originalHook, 'enqueue' => $entry['native_enqueue']);
            }
        }
    }

    private function hideMenuRow(string $slug, string $class = 'wpsuite-legacy-destination'): void
    {
        global $submenu;
        $parent = SMARTCLOUD_WPSUITE_CANONICAL_SLUG;
        foreach ($submenu[$parent] ?? array() as $index => $item) {
            if (html_entity_decode((string) ($item[2] ?? ''), ENT_QUOTES, 'UTF-8') === $slug) {
                // WordPress derives page parents, hook suffixes and access checks
                // from these rows. Retain them with their original capabilities.
                $submenu[$parent][$index][4] = trim(($item[4] ?? '') . ' ' . $class);
            }
        }
    }

    public function renderMenuStyles(): void
    {
        echo '<style id="wpsuite-navigation-menu">#adminmenu .wpsuite-legacy-destination{display:none!important}#adminmenu .wpsuite-secondary-destination{display:none!important}</style>';
    }

    public function highlightSubmenu(?string $submenuFile): ?string
    {
        if ($this->isAdvancedRequest()) {
            foreach ($this->capabilities as $entry) {
                foreach ($entry['advanced_links'] as $link) {
                    if ($this->matchesRequest($link['url'])) { return $this->capabilitySlug($entry['id'] === 'ai-tools' ? 'answers' : $entry['id']); }
                }
            }
        }
        return $this->legacyDestinations[$submenuFile ?? ''] ?? $submenuFile;
    }

    public function highlightParent(string $parentFile): string
    {
        return $this->isAdvancedRequest() ? SMARTCLOUD_WPSUITE_CANONICAL_SLUG : $parentFile;
    }

    private function isAdvancedRequest(): bool
    {
        foreach ($this->advancedUrls as $url) {
            if ($this->matchesRequest($url)) { return true; }
        }
        return false;
    }

    private function matchesRequest(string $url): bool
    {
        $parts = wp_parse_url($url);
        if (basename($parts['path'] ?? '') !== ($GLOBALS['pagenow'] ?? '')) { return false; }
        parse_str($parts['query'] ?? '', $query);
        foreach ($query as $key => $value) {
            $actual = $_GET[$key] ?? ($key === 'page' ? ($GLOBALS['plugin_page'] ?? null) : null);
            if (!is_string($actual) || wp_unslash($actual) !== $value) { return false; }
        }
        return true;
    }

    /** Navigation only: no discovery offers, REST nonce, settings or credentials. */
    public function topNavigationData(): ?array
    {
        if (!$this->registered || !current_user_can('read') || (!$this->capabilities && !current_user_can('manage_options'))) {
            return null;
        }
        $parent = SMARTCLOUD_WPSUITE_CANONICAL_SLUG;
        $page = $GLOBALS['plugin_page'] ?? ($_GET['page'] ?? '');
        $page = is_string($page) && ($GLOBALS['pagenow'] ?? '') === 'admin.php' ? wp_unslash($page) : '';
        $advanced = $page === $parent . '-advanced' || isset($this->legacyDestinations[$page]) || $this->isAdvancedRequest();
        $capabilityPages = array_map(fn(array $entry): string => $this->capabilitySlug($entry['id']), $this->capabilities);
        if ($page !== $parent && !$advanced && !in_array($page, $capabilityPages, true)) {
            return null;
        }
        $names = array('gatey' => 'Gatey', 'smartcloud-ai-kit' => 'AI-Kit', 'smartcloud-agent-composer' => 'Agent Composer', 'smartcloud-flow' => 'Flow', 'smartcloud-static-publisher' => 'Static Publisher');
        $groups = array();
        $seen = array();
        foreach ($this->capabilities as $entry) {
            $id = $entry['product_id'];
            foreach ($entry['advanced_links'] as $link) {
                if (isset($seen[$link['url']])) { continue; }
                $seen[$link['url']] = true;
                if (!isset($groups[$id])) {
                    $groups[$id] = array('label' => $entry['label'], 'product' => $names[$id] ?? $entry['product'], 'url' => admin_url('admin.php?page=' . $this->capabilitySlug($entry['id'] === 'ai-tools' ? 'answers' : $entry['id'])), 'links' => array());
                }
                $groups[$id]['links'][] = $link;
            }
        }
        if (current_user_can('manage_options')) {
            $url = admin_url('admin.php?page=' . $parent . '-settings');
            if (!isset($seen[$url])) {
                $groups['wpsuite-platform'] = array('label' => __('Platform', 'smartcloud-wpsuite'), 'links' => array(array('label' => __('Platform Settings', 'smartcloud-wpsuite'), 'url' => $url)));
            }
        }
        return array(
            'overview_url' => admin_url('admin.php?page=' . $parent),
            'advanced_url' => admin_url('admin.php?page=' . $parent . '-settings'),
            'active' => in_array($page, array($parent . '-settings', $parent . '-advanced'), true) ? 'platform' : ($page === $parent ? 'overview' : ''),
            'can_manage_connection' => current_user_can('manage_options'),
            'groups' => array_values($groups),
        );
    }

    public function isNativeHook(string $hook): bool
    {
        return isset($this->nativeHooks[$hook]);
    }

    public function enqueueNative(string $hook): void
    {
        // Overview needs only small read-only probes, not entire plugin admin UIs.
        if (($_GET['page'] ?? '') === SMARTCLOUD_WPSUITE_CANONICAL_SLUG) {
            foreach ($this->capabilities as $entry) {
                if (is_callable($entry['backend_enqueue']) && current_user_can($entry['required_capability'])) {
                    ($entry['backend_enqueue'])();
                }
            }
        }
        if (isset($this->surfaceHooks[$hook])) { ($this->surfaceHooks[$hook])(); }
        if (isset($this->detailHooks[$hook])) {
            ($this->detailHooks[$hook]['enqueue'])($this->detailHooks[$hook]['hook']);
        }
        if (isset($this->nativeHooks[$hook])) {
            // Existing plugin-owned enqueue callbacks receive their original suffix.
            $native = $this->nativeHooks[$hook];
            if (is_callable($native['enqueue'])) {
                ($native['enqueue'])($native['hook']);
            }
        }
    }

    public function hasHook(string $hook): bool
    {
        return isset($this->hooks[$hook]);
    }

    private function capabilitySlug(string $id): string
    {
        return SMARTCLOUD_WPSUITE_CANONICAL_SLUG . '-capability-' . $id;
    }

    /** Return only permission-filtered data; never include settings or credentials. */
    public function bootstrap(string $page): ?array
    {
        $parent = SMARTCLOUD_WPSUITE_CANONICAL_SLUG;
        if (!current_user_can('read')) {
            return null;
        }
        $view = $page === $parent ? 'overview' : ($page === $parent . '-advanced' ? 'advanced' : '');
        $activeId = '';
        $public = array();
        foreach ($this->capabilities as $entry) {
            if ($page === $this->capabilitySlug($entry['id'])) {
                $view = 'capability';
                $activeId = $entry['id'];
            }
            $public[] = array(
                'id' => $entry['id'],
                'label' => $entry['label'],
                'product' => $entry['product'],
                'description' => $entry['description'],
                'url' => admin_url('admin.php?page=' . $this->capabilitySlug($entry['id'])),
                'primary' => $entry['primary'],
                'quick_links' => $entry['quick_links'],
                'advanced_links' => $entry['advanced_links'],
                'surface_extension' => $entry['surface_extension'],
                'reset_url' => $entry['has_reset'] && current_user_can('manage_options') && current_user_can($entry['required_capability'])
                    ? rest_url('smartcloud-wpsuite/v1/admin-resets/' . $entry['id']) : null,
                'has_details' => !empty($entry['detail_page']) && is_callable($entry['detail_enqueue']) && current_user_can($entry['required_capability']) && has_action(get_plugin_page_hookname($entry['detail_page'], $parent)) !== false,
                'show_in_overview' => $entry['id'] !== 'ai-tools' || !in_array('answers', array_column($this->capabilities, 'id'), true),
                'surface_url' => $entry['has_surface'] && current_user_can($entry['surface_capability'])
                    ? rest_url('smartcloud-wpsuite/v1/admin-surfaces/' . $entry['id']) : null,
            );
        }
        if ($view === '') {
            return null;
        }
        return array(
            'schema_version' => 1,
            'view' => $view,
            'active_id' => $activeId,
            'overview_url' => admin_url('admin.php?page=' . $parent),
            'advanced_url' => admin_url('admin.php?page=' . $parent . '-settings'),
            'can_manage_connection' => current_user_can('manage_options'),
            'rest_nonce' => wp_create_nonce('wp_rest'),
            'capabilities' => $public,
            'platform_links' => current_user_can('manage_options') ? array(array(
                'label' => __('Platform Settings', 'smartcloud-wpsuite'),
                'url' => admin_url('admin.php?page=' . $parent . '-settings'),
            )) : array(),
            'discovery' => $view === 'overview' ? $this->discovery() : array(),
        );
    }

    /** Validate before projecting; conflicting IDs fall back to legacy menus. */
    public function resolve(array $descriptors): array
    {
        $entries = array();
        $conflicts = array();
        foreach ($descriptors as $descriptor) {
            $entry = $this->normalize($descriptor);
            if ($entry === null) {
                continue;
            }
            $id = $entry['id'];
            if (isset($entries[$id]) && $entries[$id] !== $entry) {
                $conflicts[$id] = true;
            }
            $entries[$id] = $entry;
        }
        foreach ($conflicts as $id => $_) {
            unset($entries[$id]);
        }
        $visible = array();
        foreach ($entries as $entry) {
            $cap = $entry['required_capability'];
            $entry['advanced_links'] = $this->visibleLinks($entry['advanced_links']);
            $entry['quick_links'] = $this->visibleLinks($entry['quick_links']);
            $entry['primary'] = current_user_can($cap) && $this->destinationExists($entry['primary_url'])
                ? array('label' => $entry['primary_label'], 'url' => $entry['primary_url'])
                : ($entry['quick_links'][0] ?? $entry['advanced_links'][0] ?? null);
            if ($entry['primary'] === null) {
                continue;
            }
            // A hidden legacy destination must have an equivalent visible link.
            $urls = array_column(array_merge(array($entry['primary']), $entry['quick_links'], $entry['advanced_links']), 'url');
            $entry['legacy_menu_slugs'] = array_values(array_filter($entry['legacy_menu_slugs'], static function (string $slug) use ($urls): bool {
                $url = str_contains($slug, '://') ? $slug : admin_url('admin.php?page=' . $slug);
                return in_array($url, $urls, true);
            }));
            $visible[] = $entry;
        }
        usort($visible, static fn(array $a, array $b): int => ($a['order'] <=> $b['order']) ?: strcmp($a['id'], $b['id']));
        return $visible;
    }

    private function normalize(mixed $value): ?array
    {
        if (!is_array($value) || ($value['schema_version'] ?? null) !== 1) {
            return null;
        }
        foreach (array('id', 'product_id', 'label', 'product', 'primary_label', 'required_capability') as $key) {
            if (!is_string($value[$key] ?? null) || trim($value[$key]) === '') {
                return null;
            }
        }
        if (!preg_match('/^[a-z][a-z0-9-]{0,63}$/D', $value['id']) || !preg_match('/^[a-z][a-z0-9-]{0,63}$/D', $value['product_id'])) {
            return null;
        }
        $url = $this->localUrl($value['primary_url'] ?? null);
        if ($url === null) {
            return null;
        }
        parse_str(wp_parse_url($url)['query'] ?? '', $primaryQuery);
        $entry = array(
            'id' => $value['id'],
            'product_id' => $value['product_id'],
            'label' => sanitize_text_field($value['label']),
            'product' => sanitize_text_field($value['product']),
            'description' => is_string($value['description'] ?? null) ? sanitize_text_field($value['description']) : '',
            'order' => is_int($value['order'] ?? null) ? $value['order'] : 100,
            'show_in_menu' => ($value['show_in_menu'] ?? true) !== false,
            'primary_label' => sanitize_text_field($value['primary_label']),
            'primary_url' => $url,
            'required_capability' => $value['required_capability'],
            'legacy_menu_slugs' => array(),
            'detail_page' => is_string($value['detail_page'] ?? null) && ($primaryQuery['page'] ?? null) === $value['detail_page'] && preg_match('/^[a-z][a-z0-9-]*$/D', $value['detail_page']) ? $value['detail_page'] : null,
            'detail_enqueue' => is_callable($value['detail_enqueue'] ?? null) ? $value['detail_enqueue'] : null,
            'native_surface' => ($value['native_surface'] ?? false) === true,
            'native_enqueue' => is_callable($value['native_enqueue'] ?? null) ? $value['native_enqueue'] : null,
            'has_surface' => is_callable($value['surface_provider'] ?? null),
            'has_reset' => is_array($value['configuration_reset'] ?? null),
            'surface_extension' => is_string($value['surface_extension'] ?? null) && preg_match('/^[a-z][a-z0-9-]{0,63}$/D', $value['surface_extension']) && is_callable($value['surface_enqueue'] ?? null) ? $value['surface_extension'] : null,
            'surface_enqueue' => is_callable($value['surface_enqueue'] ?? null) ? $value['surface_enqueue'] : null,
            'backend_enqueue' => is_callable($value['backend_enqueue'] ?? null) ? $value['backend_enqueue'] : null,
            'surface_capability' => is_string($value['surface_capability'] ?? null) ? $value['surface_capability'] : $value['required_capability'],
        );
        foreach (is_array($value['legacy_menu_slugs'] ?? null) ? $value['legacy_menu_slugs'] : array() as $slug) {
            if (is_string($slug) && (preg_match('/^[a-z][a-z0-9-]*$/D', $slug) || $this->localUrl($slug) !== null)) {
                $entry['legacy_menu_slugs'][] = $slug;
            }
        }
        foreach (array('advanced_links', 'quick_links') as $key) {
            $entry[$key] = array();
            foreach (is_array($value[$key] ?? null) ? $value[$key] : array() as $link) {
                if (!is_array($link) || !is_string($link['label'] ?? null) || trim($link['label']) === '') {
                    continue;
                }
                $linkUrl = $this->localUrl($link['url'] ?? null);
                $capability = $link['required_capability'] ?? $entry['required_capability'];
                if ($linkUrl !== null && is_string($capability) && $capability !== '') {
                    $entry[$key][] = array('label' => sanitize_text_field($link['label']), 'url' => $linkUrl, 'required_capability' => $capability);
                }
            }
        }
        return $entry;
    }

    private function visibleLinks(array $links): array
    {
        $visible = array();
        foreach ($links as $link) {
            if (current_user_can($link['required_capability']) && $this->destinationExists($link['url'])) {
                $visible[$link['url']] = array('label' => $link['label'], 'url' => $link['url']);
            }
        }
        return array_values($visible);
    }

    private function destinationExists(string $url): bool
    {
        $parts = wp_parse_url($url);
        parse_str($parts['query'] ?? '', $query);
        $script = basename($parts['path'] ?? '');
        if ($script === 'upload.php') {
            return current_user_can('upload_files');
        }
        if ($script === 'edit.php' || $script === 'post-new.php') {
            $postType = get_post_type_object($query['post_type'] ?? 'post');
            if ($postType === null || !$postType->show_ui) {
                return false;
            }
            $capability = $script === 'post-new.php' ? $postType->cap->create_posts : $postType->cap->edit_posts;
            return current_user_can($capability);
        }
        global $_registered_pages;
        $hook = get_plugin_page_hookname($query['page'] ?? '', SMARTCLOUD_WPSUITE_CANONICAL_SLUG);
        return isset($_registered_pages[$hook]);
    }

    /** Navigation targets only. Mutations and external redirects are not descriptors. */
    private function localUrl(mixed $url): ?string
    {
        if (!is_string($url) || preg_match('/[\x00-\x20\\\\]/', $url)) {
            return null;
        }
        $parts = wp_parse_url($url);
        $base = wp_parse_url(admin_url());
        if (!is_array($parts) || isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }
        foreach (array('scheme', 'host', 'port') as $part) {
            if (($parts[$part] ?? null) !== ($base[$part] ?? null)) {
                return null;
            }
        }
        $allowed = array(
            'admin.php' => array('page', 'section', 'aikit-page'),
            'edit.php' => array('post_type', 's'),
            'upload.php' => array(),
            'post-new.php' => array('post_type'),
        );
        $script = basename($parts['path'] ?? '');
        if (!isset($allowed[$script]) || ($parts['path'] ?? '') !== ($base['path'] ?? '') . $script) {
            return null;
        }
        parse_str($parts['query'] ?? '', $query);
        if (array_diff(array_keys($query), $allowed[$script])) {
            return null;
        }
        foreach ($query as $value) {
            if (!is_string($value)) {
                return null;
            }
        }
        if ($script === 'admin.php' && !preg_match('/^[a-z][a-z0-9_-]*$/D', $query['page'] ?? '')) {
            return null;
        }
        foreach (array('section', 'aikit-page') as $key) {
            if (isset($query[$key]) && !preg_match('/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/D', $query[$key])) {
                return null;
            }
        }
        return $url;
    }

    private function discovery(): array
    {
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $installed = get_plugins();
        $activeIds = array_column($this->capabilities, 'id');
        $cards = array();
        foreach ($this->catalog() as $entry) {
            if (in_array($entry['id'], $activeIds, true)) {
                continue;
            }
            $file = $entry['slug'] . '/' . $entry['slug'] . '.php';
            $candidates = isset($installed[$file]) ? array($file) : array();
            // Directory deployments can keep an alternate folder name. Match
            // only the plugin's own Text Domain, never a fuzzy display name.
            foreach ($installed as $candidate => $metadata) {
                if (($metadata['TextDomain'] ?? '') === $entry['slug']) {
                    $candidates[] = $candidate;
                }
            }
            $isInstalled = count($candidates) > 0;
            $active = false;
            foreach (array_unique($candidates) as $candidate) {
                if (is_plugin_active($candidate) || is_plugin_active_for_network($candidate)) {
                    $active = true;
                    break;
                }
            }
            // A registered but permission-filtered capability is not an install offer.
            if ($active) {
                continue;
            }
            $action = null;
            if ($isInstalled && current_user_can('activate_plugins')) {
                $action = array('label' => __('Manage plugin', 'smartcloud-wpsuite'), 'url' => self_admin_url('plugins.php'));
            } elseif (!$isInstalled && current_user_can('install_plugins') && wp_is_file_mod_allowed('plugins')) {
                $action = array(
                    'label' => $entry['install_label'],
                    'url' => self_admin_url('plugin-install.php?tab=plugin-information&plugin=' . rawurlencode($entry['slug'])),
                );
            }
            $cards[] = array(
                'id' => $entry['id'], 'label' => $entry['label'], 'product' => $entry['product'],
                'description' => $entry['description'], 'state' => $isInstalled ? 'inactive' : 'not_installed',
                'action' => $action,
                'message' => $isInstalled
                    ? __('This plugin is installed but is not active on this site.', 'smartcloud-wpsuite')
                    : ($action === null ? __('Ask your site administrator to install this plugin.', 'smartcloud-wpsuite') : __('Continue in WordPress to review and install the plugin.', 'smartcloud-wpsuite')),
            );
        }
        return $cards;
    }

    /** Public directory slugs verified 2026-10-07; private products are never advertised. */
    private function catalog(): array
    {
        return array(
            array('id' => 'login-access', 'slug' => 'gatey', 'label' => __('Login & Access', 'smartcloud-wpsuite'), 'product' => 'Gatey', 'description' => __('Set up sign-in and protected access with Gatey.', 'smartcloud-wpsuite'), 'install_label' => __('Install Login & Access', 'smartcloud-wpsuite')),
            array('id' => 'answers', 'slug' => 'smartcloud-ai-kit', 'label' => __('Answers', 'smartcloud-wpsuite'), 'product' => 'AI-Kit', 'description' => __('Answer visitor questions with a site-wide chatbot and an embeddable semantic search component. Connected features require additional setup.', 'smartcloud-wpsuite'), 'install_label' => __('Install AI-Kit for Answers', 'smartcloud-wpsuite')),
            array('id' => 'ai-editing', 'slug' => 'smartcloud-agent-composer', 'label' => __('AI Editing', 'smartcloud-wpsuite'), 'product' => 'Agent Composer', 'description' => __('Let AI help edit WordPress within your site rules and permissions.', 'smartcloud-wpsuite'), 'install_label' => __('Install AI Editing', 'smartcloud-wpsuite')),
            array('id' => 'forms-workflows', 'slug' => 'smartcloud-flow', 'label' => __('Forms & Workflows', 'smartcloud-wpsuite'), 'product' => 'Flow', 'description' => __('Build forms and connect their submissions to workflows.', 'smartcloud-wpsuite'), 'install_label' => __('Install Forms & Workflows', 'smartcloud-wpsuite')),
            array('id' => 'static-publishing', 'slug' => 'smartcloud-static-publisher', 'label' => __('Static Publishing', 'smartcloud-wpsuite'), 'product' => 'Static Publisher', 'description' => __('Keep WordPress as your CMS and publish a static frontend.', 'smartcloud-wpsuite'), 'install_label' => __('Install Static Publishing', 'smartcloud-wpsuite')),
        );
    }
}
