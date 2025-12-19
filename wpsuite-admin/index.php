<?php
/**
 * Admin class to create settings page and  REST API endpoint to handle parameter updates coming from the settings front-end,
 * and load the settings.
 *
 */

namespace SmartCloud\WPSuite\Hub;

use TypeError;
use Exception;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;
use WP_Filesystem_Direct;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}
if (file_exists(filename: WPSUITE_PATH . 'model.php')) {
    require_once WPSUITE_PATH . 'model.php';
}

const VERSION_WEBCRYPTO = '1.0.1';
const VERSION_AMPLIFY = '1.0.1';

class HubAdmin
{
    private SiteSettings $siteSettings;
    public function __construct()
    {
        $defaultSiteSettings = new SiteSettings(
            accountId: '',
            siteId: '',
            lastUpdate: 0,
            subscriber: false,
            siteKey: '',
        );
        try {
            $this->siteSettings = get_option(WPSUITE_SLUG . '/site-settings', $defaultSiteSettings);
            $this->siteSettings->accountId ??= '';
            $this->siteSettings->siteId ??= '';
            $this->siteSettings->lastUpdate ??= 0;
            $this->siteSettings->subscriber ??= false;
            $this->siteSettings->siteKey ??= '';
        } catch (TypeError | Exception $e) {
            $this->siteSettings = $defaultSiteSettings;
        }
        $this->registerRestRoutes();
    }

    public function init(): void
    {
        // Front‑end assets + shortcodes
        add_action('wp_enqueue_scripts', array($this, 'enqueueScripts', ), 10);
        add_action('admin_init', array($this, 'enqueueScripts'), 10);
        add_action('elementor/preview/after_enqueue_scripts', array($this, 'enqueueScripts'), 10);

    }

    /**
     * Enqueue inline scripts that expose PHP constants to JS.
     */
    public function enqueueScripts(): void
    {
        $upload_info = wp_upload_dir();
        $data = array(
            'restUrl' => rest_url(WPSUITE_SLUG . '/v1'),
            'uploadUrl' => trailingslashit($upload_info['baseurl']) . WPSUITE_SLUG . '/',
            'nonce' => wp_create_nonce('wp_rest'),
            'siteSettings' => array(
                'accountId' => $this->siteSettings->accountId,
                'siteId' => $this->siteSettings->siteId,
                'siteKey' => is_admin() ? $this->siteSettings->siteKey : '',
                'lastUpdate' => $this->siteSettings->lastUpdate,
                'subscriber' => $this->siteSettings->subscriber,
                'hubInstalled' => true,
            ),
        );
        $js = 'const __wpsuiteGlobal = (typeof globalThis !== "undefined") ? globalThis : window;
__wpsuiteGlobal.WpSuite = __wpsuiteGlobal.WpSuite ?? {};
__wpsuiteGlobal.WpSuite.plugins = __wpsuiteGlobal.WpSuite.plugins ?? {};
__wpsuiteGlobal.WpSuite.events = __wpsuiteGlobal.WpSuite.events ?? {
  emit: (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail })),
  on: (type, cb, opts) => window.addEventListener(type, cb, opts),
};
Object.assign(__wpsuiteGlobal.WpSuite, ' . wp_json_encode($data) . ');
// backward compatibility
var WpSuite = __wpsuiteGlobal.WpSuite;
';

        wp_enqueue_script('wpsuite-main-script', WPSUITE_URL . 'hub-for-wpsuiteio.js', false, WPSUITE_VERSION, false);

        wp_add_inline_script('wpsuite-main-script', $js, 'before');
    }

    public function getIconUrl()
    {
        return 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2ZXJzaW9uPSIxLjAiIHdpZHRoPSIyMHB4IiBoZWlnaHQ9IjIwcHgiIHZpZXdCb3g9IjAgMCAyNzguMDAwMDAwIDI1NC4wMDAwMDAiIHByZXNlcnZlQXNwZWN0UmF0aW89InhNaWRZTWlkIG1lZXQiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJncmVlbiIgZ3JhZGllbnRUcmFuc2Zvcm09InJvdGF0ZSg0NSkiPgogICAgICA8c3RvcCBvZmZzZXQ9IjUwJSIgc3RvcC1jb2xvcj0iIzJBQ0Q0RSI+PC9zdG9wPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiM0RUZGQUEiPjwvc3RvcD4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxzdHlsZSB0eXBlPSJ0ZXh0L2NzcyI+CgkJLnBhdGh7ZmlsbDp1cmwoJyNncmVlbicpO30KCTwvc3R5bGU+CiAgPGcgY2xhc3M9InBhdGgiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAuMDAwMDAwLDI1NC4wMDAwMDApIHNjYWxlKDAuMTAwMDAwLC0wLjEwMDAwMCkiIGZpbGw9IiMwMDAwMDAiIHN0cm9rZT0ibm9uZSI+CiAgICA8cGF0aCBkPSJNNDk1IDI1MDQgYy0xODQgLTY1IC0zMzEgLTE4NyAtNDA0IC0zMzUgLTUyIC0xMDUgLTcyIC0yMDMgLTczIC0zNDQgIDAgLTg4IDQgLTEyMyAyMiAtMTc1IDQxIC0xMjIgODkgLTIwMCAxODAgLTI5MSA3MSAtNzIgMTAxIC05NCAxODQgLTEzNSBsOTggIC00OSAxNTIgLTYgYzgzIC00IDQ1OSAtMTEgODM2IC0xNCA2NDMgLTcgNjg5IC05IDc0NSAtMjcgNzkgLTI2IDEzMyAtNTkgMTg4ICAtMTE0IDU4IC02MCA5NCAtMTMxIDExNSAtMjMyIDE5IC05MSAxMCAtMTcyIC0yOSAtMjc2IC00MCAtMTEwIC0xNjkgLTIxNyAgLTMwMyAtMjUyIC00MSAtMTEgLTIxNCAtMTQgLTg5NyAtMTQgbC04NDYgMCAtNjEgMzEgYy05MCA0NCAtMTQwIDExNCAtMTU3ICAyMTUgLTUgMzEgLTIgNDUgMTIgNjIgbDE4IDIxIDkxOSA3IDkxOSA3IDM5IDM1IGMyMSAxOSA0MSA0NSA0NCA1NyA3IDI3IC0xNCAgNzEgLTQ4IDEwMSAtMjMgMjEgLTMxIDIyIC01NDkgMjcgLTI5MCAzIC03NjUgMyAtMTA1OCAwIGwtNTMxIC02IDAgLTE1NyBjMCAgLTE4OSA5IC0yNDIgNTcgLTM0MCA2NCAtMTMyIDE4MyAtMjMwIDMzMiAtMjc0IDQ4IC0xNCAxNTIgLTE2IDkxNSAtMTYgOTY0IDAgIDkzOCAtMSAxMDg0IDcxIDY1IDMyIDEwMiA1OSAxNjUgMTIyIDE0NyAxNDcgMTk3IDI2MyAyMDUgNDc0IDQgMTE3IDIgMTM5IC0xOCAgMjAwIC04NCAyNTQgLTI1MiA0MTYgLTUwMCA0ODIgLTcwIDE4IC0xMjMgMjAgLTczMCAyNiAtMzYwIDQgLTcyNSAxMCAtODEwIDE0ICAtMTQ5IDYgLTE1OSA4IC0yMjEgMzggLTE0OSA3NCAtMjQ5IDIzNyAtMjQ5IDQwNiAwIDE4NSA5MSAzMzYgMjQ4IDQxMyA1NCAyNiAgNjcgMjggMjUyIDM1IDEwNyA0IDUwNiA4IDg4NSA4IGw2OTAgMSA2MCAtMjkgYzcxIC0zNCAxMTYgLTc5IDE0NCAtMTQxIDMwICAtNjkgMzQgLTExMSAxNCAtMTM3IGwtMTggLTIyIC05MTUgLTcgYy0xMDE3IC03IC05NTcgLTMgLTk5MCAtNzYgLTIxIC00OCAtMTMgIC04OSAyNSAtMTI4IGwyNSAtMjUgMTA0NCAwIGM1NzUgMCAxMDQ4IDQgMTA1MyA4IDQgNSA5IDg4IDExIDE4NSA0IDE3MSAzIDE3OSAgLTIyIDI0NyAtMzUgOTAgLTc0IDE1MSAtMTM5IDIxMiAtNjQgNjAgLTEyMiA5NSAtMjA2IDEyMiAtNjMgMjEgLTc5IDIxIC05NTAgIDIxIGwtODg2IC0xIC03MCAtMjV6Ij48L3BhdGg+CiAgPC9nPgo8L3N2Zz4K';
    }

    public function enqueueAdminScripts($connect_suffix/*, $diagnostics_suffix*/)
    {
        $GLOBALS['wpsuitehub_menu_parent'] = WPSUITE_SLUG;
        do_action(WPSUITE_READY_HOOK, WPSUITE_SLUG);

        //add_action('admin_enqueue_scripts', function ($hook) use ($connect_suffix, $diagnostics_suffix) {
        add_action('admin_enqueue_scripts', function ($hook) use ($connect_suffix) {
            if ($hook !== $connect_suffix /*&& $hook !== $diagnostics_suffix*/) {
                return;
            }

            wp_register_script(
                'wpsuite-webcrypto-vendor',
                plugins_url('assets/js/wpsuite-webcrypto-vendor.min.js', __FILE__),
                array(),
                VERSION_WEBCRYPTO,
                false
            );

            $script_asset = array();
            if (file_exists(WPSUITE_PATH . 'dist/index.asset.php')) {
                $script_asset = require_once(WPSUITE_PATH . 'dist/index.asset.php');
            }
            $script_asset['dependencies'] = array_merge($script_asset['dependencies'], array('wpsuite-webcrypto-vendor'));
            wp_enqueue_script('wpsuite-admin-script', WPSUITE_URL . 'dist/index.js', $script_asset['dependencies'], WPSUITE_VERSION, true);

            if ($hook === $connect_suffix) {
                $page = 'connect';
                /*} elseif ($hook === $diagnostics_suffix) {
                    $page = 'diagnostics';*/
            } else {
                $page = '';
            }
            $js = '__wpsuiteGlobal.WpSuite.view = ' . wp_json_encode($page) . ';';
            wp_add_inline_script('wpsuite-admin-script', $js, 'before');

            wp_enqueue_style('wpsuite-admin-style', WPSUITE_URL . 'dist/index.css', array('wp-components'), WPSUITE_VERSION);
        });
    }

    /**
     * Check configuration and license.
     */
    public function check(): void
    {
        if ($this->siteSettings->subscriber) {
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
                $this->reloadConfig(
                    $this->siteSettings->accountId,
                    $this->siteSettings->siteId,
                    $this->siteSettings->siteKey
                );
            }
            /* ---- 4.  unlock ---- */
            delete_transient($lock_key);
        }
    }

    public function renderAdminPage()
    {
        echo '<div id="wpsuite-admin"></div>';
    }

    public function initRestApi()
    {
        /*
        register_rest_route(
            WPSUITE_SLUG . '/v1',
            '/diagnostics',
            array(
                'methods' => 'GET',
                'permission_callback' => function () {
                    return current_user_can('manage_options');
                },
                'callback' => array($this, 'handleDiagnostics'),
            )
        );
        */

        register_rest_route(
            WPSUITE_SLUG . '/v1',
            '/update-site-settings',
            array(
                'methods' => 'POST',
                'callback' => array($this, 'updateSiteSettings'),
                'permission_callback' => function () {
                    if (!current_user_can('manage_options')) {
                        return new WP_Error('rest_forbidden', 'Forbidden', array('status' => 403));
                    }
                    return true;
                },
            )
        );
    }

    public function handleDiagnostics(\WP_REST_Request $request)
    {
        // 1) Required minimums (Requires at least / Requires PHP)
        if (!function_exists('get_plugin_data')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        // Assume the main file is named wpsuite.php in the plugin root:
        $main_file = trailingslashit(WPSUITE_PATH) . 'hub-for-wpsuite.php';
        $plugin_data = file_exists($main_file) ? get_plugin_data($main_file, false, false) : null;

        $required_wp = $plugin_data['RequiresWP'] ?? '6.7';
        $required_php = $plugin_data['RequiresPHP'] ?? '8.1';

        // 2) Measured values
        global $wp_version;
        $current_wp = $wp_version;
        $current_php = PHP_VERSION;

        // 3) Basic environment checks
        $rest_ok = null;
        $rest_error = null;
        $loopback_ok = null;
        $loopback_error = null;

        // REST reachability (own REST URL succeeds without nonce: 200/401, when fails: 0/5xx)
        $rest_url = rest_url();
        $r = wp_remote_get($rest_url, array('timeout' => 3));
        if (is_wp_error($r)) {
            $rest_ok = false;
            $rest_error = $r->get_error_message();
        } else {
            $code = (int) wp_remote_retrieve_response_code($r);
            // 200–401 elfogadható: a REST elérhető
            $rest_ok = ($code >= 200 && $code < 402);
            if (!$rest_ok) {
                $rest_error = 'HTTP ' . $code;
            }
        }

        // Loopback (server reaching itself) – home_url accessible
        $home = home_url('/');
        $lb = wp_remote_get($home, array('timeout' => 3));
        if (is_wp_error($lb)) {
            $loopback_ok = false;
            $loopback_error = $lb->get_error_message();
        } else {
            $code = (int) wp_remote_retrieve_response_code($lb);
            $loopback_ok = ($code >= 200 && $code < 400);
            if (!$loopback_ok) {
                $loopback_error = 'HTTP ' . $code;
            }
        }

        // Uploads directory
        $uploads = wp_upload_dir();
        $uploads_path = $uploads['basedir'] ?? '';
        $uploads_writable = (is_dir($uploads_path) && WP_Filesystem_Direct::is_writable($uploads_path));
        $uploads_error = $uploads['error'] ?? '';

        // SSL
        $ssl = is_ssl();

        // Site URL (pro license domain restriction)
        $site_url = site_url();

        // 4) Result and pass/fail
        $ok_wp = (version_compare($current_wp, $required_wp, '>='));
        $ok_php = (version_compare($current_php, $required_php, '>='));

        $payload = array(
            'versions' => array(
                'wp' => array(
                    'current' => $current_wp,
                    'required' => $required_wp,
                    'ok' => $ok_wp,
                ),
                'php' => array(
                    'current' => $current_php,
                    'required' => $required_php,
                    'ok' => $ok_php,
                ),
            ),
            'rest' => array(
                'url' => $rest_url,
                'ok' => $rest_ok,
                'error' => $rest_error,
            ),
            'loopback' => array(
                'url' => $home,
                'ok' => $loopback_ok,
                'error' => $loopback_error,
            ),
            'uploads' => array(
                'basedir' => $uploads_path,
                'writable' => $uploads_writable,
                'error' => $uploads_error,
            ),
            'ssl' => array(
                'enabled' => (bool) $ssl,
                'note' => 'SSL is recommended but optional.',
            ),
            'siteUrl' => $site_url,
            'timestamp' => time(),
        );

        return new \WP_REST_Response($payload, 200);
    }

    public function updateSiteSettings(WP_REST_Request $request)
    {
        $settings_param = json_decode($request->get_body());

        if ($settings_param->accountId) {
            $this->siteSettings = new SiteSettings(
                $settings_param->accountId,
                $settings_param->siteId,
                $settings_param->lastUpdate,
                $settings_param->subscriber,
                $settings_param->siteKey
            );

            update_option(WPSUITE_SLUG . '/site-settings', $this->siteSettings);
        } else {
            $this->siteSettings = new SiteSettings(
                accountId: '',
                siteId: '',
                lastUpdate: 0,
                subscriber: false,
                siteKey: '',
            );
            delete_option(WPSUITE_SLUG . '/site-settings');
        }

        if ($settings_param->subscriber) {
            $this->reloadConfig(
                $settings_param->accountId,
                $settings_param->siteId,
                $settings_param->siteKey
            );
        } else {
            $this->deleteConfig();
        }

        return new WP_REST_Response(array('success' => true, 'message' => 'Site settings updated successfully.'), 200);
    }

    private function registerRestRoutes()
    {
        if (!class_exists('WP_REST_Controller')) {
            return;
        }

        add_action('rest_api_init', array($this, 'initRestApi'));
    }

    private function reloadConfig($accountId, $siteId, $siteKey)
    {
        $api_base = 'https://api.wpsuite.io';

        // Ha a WordPress-URL tartalmazza a dev-domaint, akkor /dev-et fűzünk hozzá
        if (strpos(get_site_url(), 'dev.wpsuite.io') !== false) {
            $api_base .= '/dev';
        }

        $endpoint = sprintf(
            '%s/account/%s/site/%s/license',
            $api_base,
            $accountId,
            $siteId
        );

        $args = [
            'headers' => [
                'Accept' => 'application/json',
                'X-Site-Key' => $siteKey,
            ],
            'timeout' => 10,
        ];

        $response = wp_remote_get($endpoint, $args);

        if (!is_wp_error($response)) {
            $status = wp_remote_retrieve_response_code($response);
            if (200 === $status) {
                $body = wp_remote_retrieve_body($response);
                $data = json_decode($body, true);
                if (is_array($data) && isset($data['config'], $data['jws'])) {
                    $upload_dir_info = wp_upload_dir();
                    $base_dir = trailingslashit($upload_dir_info['basedir']);
                    $plugin_subdir = trailingslashit($base_dir . WPSUITE_SLUG);

                    wp_mkdir_p($plugin_subdir);

                    $config_path = $plugin_subdir . 'config.enc';
                    $jws_path = $plugin_subdir . 'lic.jws';

                    // Biztonságosabb fájl-írás WP_Filesystem-mel, de röviden:
                    file_put_contents($config_path, sanitize_text_field($data['config']));
                    file_put_contents($jws_path, sanitize_text_field($data['jws']));

                    update_option(WPSUITE_SLUG . '/license-last-refresh', time());
                }
            }
        }
    }

    private function deleteConfig()
    {
        $upload_dir_info = wp_upload_dir();
        $base_dir = trailingslashit($upload_dir_info['basedir']);
        $plugin_subdir = trailingslashit($base_dir . WPSUITE_SLUG);

        $config_path = $plugin_subdir . 'config.enc';
        $jws_path = $plugin_subdir . 'lic.jws';

        if (file_exists($config_path)) {
            wp_delete_file($config_path);
        }
        if (file_exists($jws_path)) {
            wp_delete_file($jws_path);
        }
    }

}