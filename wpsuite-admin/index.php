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

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}
if (file_exists(filename: WPSUITE_PATH . 'model.php')) {
    require_once WPSUITE_PATH . 'model.php';
}
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
    public function getSiteSettings(): SiteSettings
    {
        return $this->siteSettings;
    }

    function addMenu()
    {
        $icon_url = 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2ZXJzaW9uPSIxLjAiIHdpZHRoPSIyMHB4IiBoZWlnaHQ9IjIwcHgiIHZpZXdCb3g9IjAgMCAyNzguMDAwMDAwIDI1NC4wMDAwMDAiIHByZXNlcnZlQXNwZWN0UmF0aW89InhNaWRZTWlkIG1lZXQiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJncmVlbiIgZ3JhZGllbnRUcmFuc2Zvcm09InJvdGF0ZSg0NSkiPgogICAgICA8c3RvcCBvZmZzZXQ9IjUwJSIgc3RvcC1jb2xvcj0iIzJBQ0Q0RSI+PC9zdG9wPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiM0RUZGQUEiPjwvc3RvcD4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxzdHlsZSB0eXBlPSJ0ZXh0L2NzcyI+CgkJLnBhdGh7ZmlsbDp1cmwoJyNncmVlbicpO30KCTwvc3R5bGU+CiAgPGcgY2xhc3M9InBhdGgiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAuMDAwMDAwLDI1NC4wMDAwMDApIHNjYWxlKDAuMTAwMDAwLC0wLjEwMDAwMCkiIGZpbGw9IiMwMDAwMDAiIHN0cm9rZT0ibm9uZSI+CiAgICA8cGF0aCBkPSJNNDk1IDI1MDQgYy0xODQgLTY1IC0zMzEgLTE4NyAtNDA0IC0zMzUgLTUyIC0xMDUgLTcyIC0yMDMgLTczIC0zNDQgIDAgLTg4IDQgLTEyMyAyMiAtMTc1IDQxIC0xMjIgODkgLTIwMCAxODAgLTI5MSA3MSAtNzIgMTAxIC05NCAxODQgLTEzNSBsOTggIC00OSAxNTIgLTYgYzgzIC00IDQ1OSAtMTEgODM2IC0xNCA2NDMgLTcgNjg5IC05IDc0NSAtMjcgNzkgLTI2IDEzMyAtNTkgMTg4ICAtMTE0IDU4IC02MCA5NCAtMTMxIDExNSAtMjMyIDE5IC05MSAxMCAtMTcyIC0yOSAtMjc2IC00MCAtMTEwIC0xNjkgLTIxNyAgLTMwMyAtMjUyIC00MSAtMTEgLTIxNCAtMTQgLTg5NyAtMTQgbC04NDYgMCAtNjEgMzEgYy05MCA0NCAtMTQwIDExNCAtMTU3ICAyMTUgLTUgMzEgLTIgNDUgMTIgNjIgbDE4IDIxIDkxOSA3IDkxOSA3IDM5IDM1IGMyMSAxOSA0MSA0NSA0NCA1NyA3IDI3IC0xNCAgNzEgLTQ4IDEwMSAtMjMgMjEgLTMxIDIyIC01NDkgMjcgLTI5MCAzIC03NjUgMyAtMTA1OCAwIGwtNTMxIC02IDAgLTE1NyBjMCAgLTE4OSA5IC0yNDIgNTcgLTM0MCA2NCAtMTMyIDE4MyAtMjMwIDMzMiAtMjc0IDQ4IC0xNCAxNTIgLTE2IDkxNSAtMTYgOTY0IDAgIDkzOCAtMSAxMDg0IDcxIDY1IDMyIDEwMiA1OSAxNjUgMTIyIDE0NyAxNDcgMTk3IDI2MyAyMDUgNDc0IDQgMTE3IDIgMTM5IC0xOCAgMjAwIC04NCAyNTQgLTI1MiA0MTYgLTUwMCA0ODIgLTcwIDE4IC0xMjMgMjAgLTczMCAyNiAtMzYwIDQgLTcyNSAxMCAtODEwIDE0ICAtMTQ5IDYgLTE1OSA4IC0yMjEgMzggLTE0OSA3NCAtMjQ5IDIzNyAtMjQ5IDQwNiAwIDE4NSA5MSAzMzYgMjQ4IDQxMyA1NCAyNiAgNjcgMjggMjUyIDM1IDEwNyA0IDUwNiA4IDg4NSA4IGw2OTAgMSA2MCAtMjkgYzcxIC0zNCAxMTYgLTc5IDE0NCAtMTQxIDMwICAtNjkgMzQgLTExMSAxNCAtMTM3IGwtMTggLTIyIC05MTUgLTcgYy0xMDE3IC03IC05NTcgLTMgLTk5MCAtNzYgLTIxIC00OCAtMTMgIC04OSAyNSAtMTI4IGwyNSAtMjUgMTA0NCAwIGM1NzUgMCAxMDQ4IDQgMTA1MyA4IDQgNSA5IDg4IDExIDE4NSA0IDE3MSAzIDE3OSAgLTIyIDI0NyAtMzUgOTAgLTc0IDE1MSAtMTM5IDIxMiAtNjQgNjAgLTEyMiA5NSAtMjA2IDEyMiAtNjMgMjEgLTc5IDIxIC05NTAgIDIxIGwtODg2IC0xIC03MCAtMjV6Ij48L3BhdGg+CiAgPC9nPgo8L3N2Zz4K';
        add_menu_page(
            'WPSuite.io',
            'WPSuite.io',
            'manage_options',
            WPSUITE_SLUG,
            null,
            $icon_url,
            58,
        );

        $connect_suffix = add_submenu_page(
            WPSUITE_SLUG,
            'Connect your Site',
            'Connect your Site',
            'manage_options',
            WPSUITE_SLUG,
            array($this, 'renderAdminPage'),
        );

        $GLOBALS['wpsuitehub_menu_parent'] = WPSUITE_SLUG;
        do_action(WPSUITE_READY_HOOK, WPSUITE_SLUG);

        add_action('admin_enqueue_scripts', function ($hook) use ($connect_suffix) {
            if ($hook !== $connect_suffix) {
                return;
            }

            $script_asset = array();
            if (file_exists(WPSUITE_PATH . 'dist/index.asset.php')) {
                $script_asset = require_once(WPSUITE_PATH . 'dist/index.asset.php');
            }
            wp_enqueue_script('wpsuite-admin-script', WPSUITE_URL . 'dist/index.js', $script_asset['dependencies'], WPSUITE_VERSION, true);

            wp_enqueue_style('wpsuite-admin-style', WPSUITE_URL . 'dist/index.css', array('wp-components'), WPSUITE_VERSION);
        });
    }

    function renderAdminPage()
    {
        echo '<div id="wpsuite-admin"></div>';
    }

    function registerRestRoutes()
    {
        if (!class_exists('WP_REST_Controller')) {
            return;
        }

        add_action('rest_api_init', array($this, 'initRestApi'));
    }

    function initRestApi()
    {
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

    function updateSiteSettings(WP_REST_Request $request)
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

    function reloadConfig($accountId, $siteId, $siteKey)
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

    function deleteConfig()
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