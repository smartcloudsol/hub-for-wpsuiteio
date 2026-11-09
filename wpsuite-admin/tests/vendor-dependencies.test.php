<?php
declare(strict_types=1);
namespace SmartCloud\WPSuite\Hub { class BackendProfiles { public static function boot(): void {} } }
namespace {
    $dir = sys_get_temp_dir() . '/wpsuite-vendor-test-' . bin2hex(random_bytes(8));
    mkdir($dir); mkdir($dir . '/assets'); mkdir($dir . '/assets/js');
    file_put_contents($dir . '/assets/js/amplify-vendor.min.js', 'fixture');
    file_put_contents($dir . '/assets/js/mantine-vendor.min.js', 'mantine-first');
    file_put_contents($dir . '/backend-profiles.php', '<?php');
    file_put_contents($dir . '/navigation.php', '<?php');
    file_put_contents($dir . '/main.asset.php', "<?php return array('dependencies' => array('wp-element', 'react-jsx-runtime'));");
    define('ABSPATH', $dir); define('SMARTCLOUD_WPSUITE_PATH', $dir . '/');
    define('SMARTCLOUD_WPSUITE_URL', 'https://example.test/'); define('SMARTCLOUD_WPSUITE_VERSION', 'test');
    define('SMARTCLOUD_WPSUITE_CANONICAL_SLUG', 'smartcloud-wpsuite'); define('SMARTCLOUD_WPSUITE_LEGACY_SLUG', 'smartcloud-wpsuiteio'); define('SMARTCLOUD_WPSUITE_READY_HOOK', 'smartcloud_wpsuite_ready');
    $GLOBALS['registrations'] = array(); $GLOBALS['hooks'] = array(); $GLOBALS['enqueued'] = array(); $GLOBALS['versions'] = array();
    function wp_register_script($handle, $url, $deps, ...$other): void { $GLOBALS['registrations'][$handle] = $deps; $GLOBALS['versions'][$handle] = $other[0] ?? null; }
    function wp_enqueue_script(...$args): void { $GLOBALS['enqueued'][$args[0]] = $args; } function wp_enqueue_style(...$args): void {}
    function wp_add_inline_script(...$args): void {} function wp_json_encode($v): string { return json_encode($v); }
    function do_action(...$args): void {} function add_action($hook, $callback): void { $GLOBALS['hooks'][$hook] = $callback; }
    require __DIR__ . '/../php/index.php';
    require __DIR__ . '/../php/model.php';
    $hub = (new ReflectionClass(SmartCloud\WPSuite\Hub\HubAdmin::class))->newInstanceWithoutConstructor();
    $settingsProperty = new ReflectionProperty($hub, 'siteSettings');
    $settingsProperty->setValue($hub, new SmartCloud\WPSuite\Hub\SiteSettings());
    $hub->enqueueScripts();
    if (isset($GLOBALS['enqueued']['smartcloud-wpsuite-main-script'])) throw new RuntimeException('Unconfigured main script was enqueued');
    $settingsProperty->setValue($hub, new SmartCloud\WPSuite\Hub\SiteSettings(reCaptchaPublicKey: 'test-key', renderRecaptchaProvider: false));
    $hub->enqueueScripts();
    if (isset($GLOBALS['enqueued']['smartcloud-wpsuite-main-script'])) throw new RuntimeException('Disabled provider enqueued main script');
    $settingsProperty->setValue($hub, new SmartCloud\WPSuite\Hub\SiteSettings(reCaptchaPublicKey: 'test-key', renderRecaptchaProvider: true));
    $hub->enqueueScripts();
    if (($GLOBALS['enqueued']['smartcloud-wpsuite-main-script'][2] ?? null) !== array('wp-element', 'react-jsx-runtime')) throw new RuntimeException('Configured provider did not enqueue main dependencies');
    foreach (array('smartcloud-wpsuite-amplify-vendor', 'smartcloud-wpsuite-mantine-vendor') as $handle) {
        if (($GLOBALS['registrations'][$handle] ?? null) !== array('react', 'react-dom', 'react-jsx-runtime')) throw new RuntimeException('Missing frontend dependency: ' . $handle);
    }
    $first = SmartCloud\WPSuite\Hub\VERSION_MANTINE . '-' . substr(hash('sha256', 'mantine-first'), 0, 16);
    if ($GLOBALS['versions']['smartcloud-wpsuite-mantine-vendor'] !== $first) throw new RuntimeException('Frontend Mantine payload version mismatch');
    $GLOBALS['registrations'] = array(); $hub->enqueueAdminScripts('fixture');
    $GLOBALS['hooks']['admin_enqueue_scripts']('fixture');
    if (($GLOBALS['registrations']['smartcloud-wpsuite-mantine-vendor'] ?? null) !== array('react', 'react-dom', 'react-jsx-runtime')) throw new RuntimeException('Missing admin dependency');
    if ($GLOBALS['versions']['smartcloud-wpsuite-mantine-vendor'] !== $first) throw new RuntimeException('Admin Mantine payload version mismatch');
    file_put_contents($dir . '/assets/js/mantine-vendor.min.js', 'mantine-second');
    $second = SmartCloud\WPSuite\Hub\VERSION_MANTINE . '-' . substr(hash('sha256', 'mantine-second'), 0, 16);
    $hub->enqueueScripts();
    if ($second === $first || $GLOBALS['versions']['smartcloud-wpsuite-mantine-vendor'] !== $second) throw new RuntimeException('Frontend payload change did not change version');
    $GLOBALS['hooks']['admin_enqueue_scripts']('fixture');
    if ($GLOBALS['versions']['smartcloud-wpsuite-mantine-vendor'] !== $second) throw new RuntimeException('Admin payload change did not change version');
    unlink($dir . '/assets/js/mantine-vendor.min.js'); unlink($dir . '/main.asset.php'); unlink($dir . '/assets/js/amplify-vendor.min.js'); unlink($dir . '/backend-profiles.php'); unlink($dir . '/navigation.php'); rmdir($dir . '/assets/js'); rmdir($dir . '/assets'); rmdir($dir);
    echo "Vendor registration dependency checks passed.\n";
}
