<?php
/**
 * Plugin Name:       Hub for WPSuite.io
 * Plugin URI:        https://wpsuite.io/
 * Description:       Central Hub for WPSuite.io plugins — manage your site connection, licensing, and shared admin pages for all WPSuite.io extensions.
 * Requires at least: 6.7
 * Tested up to:      6.8
 * Requires PHP:      8.1
 * Version:           1.0.0
 * Author:            Smart Cloud Solutions Inc.
 * Author URI:        https://smart-cloud-solutions.com
 * License:           MIT
 * License URI:       https://mit-license.org/
 * Text Domain:       hub-for-wpsuiteio
 *
 * @package           hub-for-wpsuiteio
 */

namespace SmartCloud\WPSuite\Hub;

const VERSION = '1.0.0';

if (!defined('ABSPATH')) {
    exit;
}

if (version_compare(PHP_VERSION, '8.1', '<')) {
    deactivate_plugins(plugin_basename(__FILE__));
    wp_die(
        esc_html__('Hub for WP Suite requires PHP 8.1 or higher.', 'hub-for-wpsuiteio'),
        esc_html__('Plugin dependency check', 'hub-for-wpsuiteio'),
        array('back_link' => true)
    );
}

/**
 * Main plugin class.
 */
final class WpSuite_Plugin
{

    /** Singleton instance */
    private static ?WpSuite_Plugin $instance = null;

    /** Admin instance */
    private Admin $admin;

    private function __construct()
    {
        $this->define_constants();
        $this->includes();
    }

    /**
     * Access the singleton instance.
     */
    public static function instance(): WpSuite_Plugin
    {
        return self::$instance ?? (self::$instance = new self());
    }

    /**
     * Define required constants.
     */
    private function define_constants(): void
    {
        define('WPSUITE_VERSION', VERSION);
        define('WPSUITE_PATH', plugin_dir_path(__FILE__));
        define('WPSUITE_URL', plugin_dir_url(__FILE__));
        define('WPSUITE_SLUG', 'hub-for-wpsuiteio');
        define('WPSUITE_READY_HOOK', 'hub-for-wpsuiteio/ready');
    }

    /**
     * Include admin classes or additional files.
     */
    private function includes(): void
    {
        // Admin classes (refactored earlier).
        if (file_exists(__DIR__ . '/admin/index.php')) {
            require_once __DIR__ . '/admin/index.php';
        }
        if (class_exists('\SmartCloud\WPSuite\Hub\Admin')) {
            $this->admin = new \SmartCloud\WPSuite\Hub\Admin();
        }
    }

    /**
     * Check configuration and license.
     */
    public function check(): void
    {
        $siteSettings = $this->admin->getSiteSettings();
        if ($siteSettings->subscriber) {
            // If the site is a subscriber, we need to check if the configuration and the license exist.

            $lock_key = WPSUITE_SLUG . '/license-refresh-lock';
            $time_key = WPSUITE_SLUG . '/license-last-refresh';

            /* ---- 1.  handling race-conditions (5-minute lock) ---- */
            if (get_transient($lock_key)) {
                return;
            }
            set_transient($lock_key, 1, 5 * MINUTE_IN_SECONDS);

            /* ---- 2.  do we need to refresh? ---- */
            $need_refresh = false;

            $upload_dir_info = wp_upload_dir();
            $base_dir = trailingslashit($upload_dir_info['basedir']);
            $plugin_subdir = trailingslashit($base_dir . WPSUITE_SLUG);
            $config_path = $plugin_subdir . 'config.enc';
            $jws_path = $plugin_subdir . 'lic.jws';
            $exists = file_exists($config_path) && file_exists($jws_path);

            if (!$exists) {
                $need_refresh = true;
            }

            // 2/b) was the last successful refresh more than a week ago?
            $last = (int) get_option($time_key, 0);
            if (time() - $last >= WEEK_IN_SECONDS) {
                $need_refresh = true;
            }

            /* ---- 3.  refresh if we need to ---- */
            if ($need_refresh) {
                $this->admin->reloadConfig(
                    $siteSettings->accountId,
                    $siteSettings->siteId,
                    $siteSettings->siteKey
                );
            }
            /* ---- 4.  unlock ---- */
            delete_transient($lock_key);
        }
    }

    /**
     * Init callback – registers blocks.
     */
    public function init(): void
    {
        // Hooks.
        add_action('admin_menu', array($this, 'createAdminMenu'), 10);

        // Front‑end assets + shortcodes
        add_action('wp_enqueue_scripts', array($this, 'enqueueAssets'), 10);
        add_action('admin_init', array($this, 'enqueueAssets'), 10);
        add_action('elementor/preview/after_enqueue_scripts', array($this, 'enqueueAssets'), 10);

    }

    /**
     * Enqueue inline scripts that expose PHP constants to JS.
     */
    public function enqueueAssets(): void
    {
        $siteSettings = $this->admin->getSiteSettings();

        wp_enqueue_script('wpsuite-main-script', WPSUITE_URL . 'hub-for-wpsuiteio.js', array(), WPSUITE_VERSION, false);

        $upload_info = wp_upload_dir();
        $data = array(
            'restUrl' => rest_url(WPSUITE_SLUG . '/v1'),
            'uploadUrl' => trailingslashit($upload_info['baseurl']) . WPSUITE_SLUG . '/',
            'nonce' => wp_create_nonce('wp_rest'),
            'siteSettings' => array(
                'accountId' => $siteSettings->accountId,
                'siteId' => $siteSettings->siteId,
                'siteKey' => is_admin() ? $siteSettings->siteKey : '',
                'lastUpdate' => $siteSettings->lastUpdate,
                'subscriber' => $siteSettings->subscriber,
                'hubInstalled' => true,
            ),
        );
        $js = 'const WpSuite = ' . wp_json_encode($data) . ';';
        wp_add_inline_script('wpsuite-main-script', $js, 'before');
    }

    /**
     * Add settings page in wp-admin.
     */
    public function createAdminMenu(): void
    {
        $this->admin->addMenu();
    }
}

// Bootstrap plugin.
if (defined('WPSUITE_BOOTSTRAPPED')) {
    return;
}
define('WPSUITE_BOOTSTRAPPED', true);

add_action('plugins_loaded', 'SmartCloud\WPSuite\Hub\wpsuite_check', 20);
add_action('init', 'SmartCloud\WPSuite\Hub\wpsuite_init');
function wpsuite_check()
{
    $instance = wpsuite();
    $instance->check();
}
function wpsuite_init()
{
    $instance = wpsuite();
    $instance->init();
}

/**
 * Accessor function
 *
 * @return \SmartCloud\WPSuite\Hub\WPSuite_Plugin
 */
function wpsuite()
{
    return WPSuite_Plugin::instance();
}
