<?php
declare(strict_types=1);
namespace {
    define('ABSPATH', __DIR__ . '/');
    define('SMARTCLOUD_WPSUITE_PATH', dirname(__DIR__) . '/php/');
    define('SMARTCLOUD_WPSUITE_CANONICAL_SLUG', 'smartcloud-wpsuite');
    define('SMARTCLOUD_WPSUITE_VERSION', 'test-hub-version');
    function rest_url($path): string { return 'https://example.test/' . $path; }
    function wp_create_nonce($action): string { return 'nonce'; }
    function current_user_can($cap): bool { return $GLOBALS['can_manage'] && $cap === 'manage_options'; }
    function is_admin(): bool { return $GLOBALS['admin']; }
    function is_wp_error($value): bool { return false; }
    function get_option($key, $default = false): mixed { return $default; }
    function site_url($path = ''): string { return 'https://example.test' . $path; }
    function home_url($path = ''): string { return 'https://example.test' . $path; }
    function wp_json_encode($data, $flags = 0): string|false { return json_encode($data, $flags); }
    function wp_script_is($handle, $status): bool { return isset($GLOBALS['queued'][$handle]); }
    function wp_register_script($handle, $src, $deps, $version, $footer): void { $GLOBALS['registered'][$handle] = array($src, $deps, $footer); }
    function wp_enqueue_script($handle): void { $GLOBALS['queued'][$handle] = true; }
    function wp_add_inline_script($handle, $js, $position): void { if (!isset($GLOBALS['queued'][$handle])) throw new \RuntimeException('Handle not enqueued'); $GLOBALS['inline'][] = $js; }
    require SMARTCLOUD_WPSUITE_PATH . 'index.php';
    $hub = (new \ReflectionClass(SmartCloud\WPSuite\Hub\HubAdmin::class))->newInstanceWithoutConstructor();
    (new \ReflectionProperty($hub, 'siteSettings'))->setValue($hub, new SmartCloud\WPSuite\Hub\SiteSettings(siteKey: 'secret', workspaceId: '</script><script>alert(1)</script>'));
    (new \ReflectionProperty($hub, 'customTranslations'))->setValue($hub, new SmartCloud\WPSuite\Hub\CustomTranslationsCatalog(static fn(string $revision): string => ''));
    foreach ([[false, true, false], [true, false, false], [true, true, true]] as [$admin, $manage, $keyVisible]) {
        $GLOBALS['admin'] = $admin; $GLOBALS['can_manage'] = $manage; $GLOBALS['queued'] = []; $GLOBALS['inline'] = [];
        (new \ReflectionProperty($hub, 'bootstrapEnqueued'))->setValue($hub, false);
        ob_start(); $hub->addMainScript(); $hub->addMainScript(); $output = ob_get_clean();
        $js = $GLOBALS['inline'][0] ?? '';
        if ($output !== '' || count($GLOBALS['inline']) !== 1 || $GLOBALS['registered']['smartcloud-wpsuite-bootstrap'] !== [false, [], false]) throw new \RuntimeException('Bootstrap registration or idempotence failed');
        if (str_contains($js, 'secret') !== $keyVisible || str_contains($js, '</script>') || !str_contains($js, '\\u003C')) throw new \RuntimeException('Bootstrap disclosure or JSON escaping failed');
    }
    echo "Bootstrap enqueue frontend/admin checks passed.\n";
}
