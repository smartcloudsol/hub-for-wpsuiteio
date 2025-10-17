<?php

namespace SmartCloud\WPSuite\Hub;

const HUB_VERSION = '1.0.0';

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}

final class Loader
{
    private static ?Loader $instance = null;

    private string $plugin;

    /** Hub admin instance */
    private HubAdmin $admin;

    private function __construct($plugin)
    {
        $this->plugin = $plugin;
        $this->includes();
    }

    /**
     * Access the singleton instance.
     */
    public static function instance($plugin): Loader
    {
        return self::$instance ?? (self::$instance = new self($plugin));
    }

    private function includes()
    {
        if (!function_exists('is_plugin_active')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        if (!empty($GLOBALS['wpsuitehub_menu_parent']) || is_plugin_active('hub-for-wpsuiteio/hub-for-wpsuiteio.php')) {
            return false;
        }

        // If Hub is not present, try to create a single common top-level menu
        // Mutex: first writer wins on the option
        define('WPSUITE_SLUG', 'hub-for-wpsuiteio');
        $fallback_parent = WPSUITE_SLUG; // common top-level slug
        $owner_option = WPSUITE_SLUG . '/top-menu-owner';

        $owner = get_option($owner_option); // may be string or false/null
        $owner_missing = empty($owner);
        $owner_is_me = ($owner === $this->plugin);
        $owner_inactive = ($owner && !is_plugin_active($owner));

        // If there is no owner yet, try to claim it
        if ($owner_missing || $owner_is_me || $owner_inactive) {
            $result = false;
            // add_option atomic: only one can win in case of multiple concurrent requests
            if (empty($GLOBALS['wpsuite_fallback_parent_added'])) {
                $GLOBALS['wpsuite_fallback_parent_added'] = true;
                $result = true;

                define('WPSUITE_VERSION', HUB_VERSION);
                define('WPSUITE_PATH', plugin_dir_path(__FILE__));
                define('WPSUITE_URL', plugin_dir_url(__FILE__));
                define('WPSUITE_READY_HOOK', WPSUITE_SLUG . '/ready');

                if (file_exists(WPSUITE_PATH . 'index.php')) {
                    require_once WPSUITE_PATH . 'index.php';
                }
                if (class_exists('\SmartCloud\WPSuite\Hub\HubAdmin')) {
                    $this->admin = new HubAdmin();
                }
            }
            if (get_option($owner_option) !== $this->plugin) {
                update_option($owner_option, $this->plugin, false);
            }
            return $result;
        }

        return false;
    }

    /**
     * Hub init callback
     */
    public function init(): void
    {
        if (!isset($this->admin)) {
            return;
        }
        // Hooks.
        add_action('admin_menu', array($this, 'createAdminMenu'), 10);

        // Front‑end assets + shortcodes
        add_action('wp_enqueue_scripts', array($this, 'enqueueAdminAssets', ), 10);
        add_action('admin_init', array($this, 'enqueueAdminAssets'), 10);
        add_action('elementor/preview/after_enqueue_scripts', array($this, 'enqueueAdminAssets'), 10);

    }

    public function createAdminMenu(): void
    {
        if (!isset($this->admin)) {
            return;
        }
        $this->admin->addMenu();
    }

    /**
     * Enqueue inline scripts that expose PHP constants to JS.
     */
    public function enqueueAdminAssets(): void
    {
        if (!isset($this->admin)) {
            return;
        }
        $siteSettings = $this->admin->getSiteSettings();

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

        wp_enqueue_script('wpsuite-main-script', WPSUITE_URL . 'hub-for-wpsuiteio.js', false, WPSUITE_VERSION, false);

        wp_add_inline_script('wpsuite-main-script', $js, 'before');
    }

    /**
     * Check configuration and license.
     */
    public function check(): void
    {
        if (!isset($this->admin)) {
            return;
        }
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


}