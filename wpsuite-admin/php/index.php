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
if (file_exists(filename: SMARTCLOUD_WPSUITE_PATH . 'model.php')) {
    require_once SMARTCLOUD_WPSUITE_PATH . 'model.php';
}

const VERSION_WEBCRYPTO = '1.1.5';
const VERSION_AMPLIFY = '1.1.6';
const VERSION_MANTINE = '1.0.8';
const WPSUITE_THEME_CSS_FILENAME = 'wpsuite-theme.css';

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
            wpsuiteThemeCss: '',
            reCaptchaPublicKey: '',
            useRecaptchaNet: false,
            useRecaptchaEnterprise: false,
            renderRecaptchaProvider: true,
        );
        try {
            $this->siteSettings = get_option(SMARTCLOUD_WPSUITE_SLUG . '/site-settings', $defaultSiteSettings);
            $this->siteSettings->accountId ??= '';
            $this->siteSettings->siteId ??= '';
            $this->siteSettings->lastUpdate ??= 0;
            $this->siteSettings->subscriber ??= false;
            $this->siteSettings->siteKey ??= '';
            $this->siteSettings->wpsuiteThemeCss ??= '';
            $this->siteSettings->reCaptchaPublicKey ??= '';
            $this->siteSettings->useRecaptchaNet ??= false;
            $this->siteSettings->useRecaptchaEnterprise ??= false;
            $this->siteSettings->renderRecaptchaProvider ??= true;
        } catch (TypeError | Exception $e) {
            $this->siteSettings = $defaultSiteSettings;
        }
        $this->registerRestRoutes();
    }

    public function init(): void
    {
        add_action('wp_head', array($this, 'addMainScript', ), 1);
        add_action('admin_head', array($this, 'addMainScript'), 1);

        // Front‑end assets + shortcodes
        add_action('wp_enqueue_scripts', array($this, 'enqueueScripts', ), 10);
        add_action('admin_init', array($this, 'enqueueScripts'), 10);
        add_action('elementor/preview/after_enqueue_scripts', array($this, 'enqueueScripts'), 10);

    }

    /**
     * Add inline scripts that expose PHP constants to JS.
     */
    public function addMainScript(): void
    {
        $upload_paths = $this->getHubUploadPaths();
        $data = array(
            'restUrl' => rest_url(SMARTCLOUD_WPSUITE_SLUG . '/v1'),
            'uploadUrl' => $upload_paths['url'],
            'nonce' => wp_create_nonce('wp_rest'),
            'siteSettings' => array(
                'accountId' => $this->siteSettings->accountId,
                'siteId' => $this->siteSettings->siteId,
                'siteKey' => is_admin() ? $this->siteSettings->siteKey : '',
                'lastUpdate' => $this->siteSettings->lastUpdate,
                'subscriber' => $this->siteSettings->subscriber,
                'wpsuiteThemeCss' => $this->siteSettings->wpsuiteThemeCss,
                'reCaptchaPublicKey' => $this->siteSettings->reCaptchaPublicKey,
                'useRecaptchaNet' => $this->siteSettings->useRecaptchaNet,
                'useRecaptchaEnterprise' => $this->siteSettings->useRecaptchaEnterprise,
                'renderRecaptchaProvider' => $this->siteSettings->renderRecaptchaProvider,
                'hubInstalled' => true,
            ),
        );
        $js = 'const __wpsuiteGlobal = (typeof globalThis !== "undefined") ? globalThis : window;
__wpsuiteGlobal.WpSuite = __wpsuiteGlobal.WpSuite ?? {};
__wpsuiteGlobal.WpSuite.plugins = __wpsuiteGlobal.WpSuite.plugins ?? {};
__wpsuiteGlobal.WpSuite.events = __wpsuiteGlobal.WpSuite.events ?? {
  emit: function (type, detail) { window.dispatchEvent(new CustomEvent(type, { detail })); },
  on: function (type, cb, opts) { window.addEventListener(type, cb, opts); },
};
Object.assign(__wpsuiteGlobal.WpSuite, ' . wp_json_encode($data) . ');
// backward compatibility
var WpSuite = __wpsuiteGlobal.WpSuite;
';
        wp_print_inline_script_tag(wp_kses_post($js));
    }

    /**
     * Enqueue inline scripts that expose PHP constants to JS.
     */
    public function enqueueScripts(): void
    {
        wp_register_script(
            'smartcloud-wpsuite-webcrypto-vendor',
            SMARTCLOUD_WPSUITE_URL . 'assets/js/webcrypto-vendor.min.js',
            array(),
            \SmartCloud\WPSuite\Hub\VERSION_WEBCRYPTO,
            array('in_footer' => true, 'strategy' => 'defer')
        );

        wp_register_script(
            'smartcloud-wpsuite-amplify-vendor',
            SMARTCLOUD_WPSUITE_URL . 'assets/js/amplify-vendor.min.js',
            array("react", "react-dom"),
            \SmartCloud\WPSuite\Hub\VERSION_AMPLIFY,
            array('in_footer' => true, 'strategy' => 'defer')
        );

        wp_register_script(
            'smartcloud-wpsuite-mantine-vendor',
            SMARTCLOUD_WPSUITE_URL . 'assets/js/mantine-vendor.min.js',
            array("react", "react-dom"),
            \SmartCloud\WPSuite\Hub\VERSION_MANTINE,
            array('in_footer' => true, 'strategy' => 'defer')
        );

        $main_script_dependencies = $this->getAssetDependencies(SMARTCLOUD_WPSUITE_PATH . 'main.asset.php');
        wp_enqueue_script('smartcloud-wpsuite-main-script', SMARTCLOUD_WPSUITE_URL . 'main.js', $main_script_dependencies, SMARTCLOUD_WPSUITE_VERSION, array('in_footer' => true, 'strategy' => 'defer'));

        //wp_add_inline_script('smartcloud-wpsuite-main-script', $js, 'before');
    }

    private function getAssetDependencies(string $asset_path): array
    {
        if (!file_exists($asset_path)) {
            return array();
        }

        $asset = require($asset_path);
        if (!is_array($asset)) {
            return array();
        }

        return is_array($asset['dependencies'] ?? null) ? $asset['dependencies'] : array();
    }

    public function getIconUrl()
    {
        return 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2ZXJzaW9uPSIxLjAiIHdpZHRoPSIyMHB4IiBoZWlnaHQ9IjIwcHgiIHZpZXdCb3g9IjAgMCAyNzguMDAwMDAwIDI1NC4wMDAwMDAiIHByZXNlcnZlQXNwZWN0UmF0aW89InhNaWRZTWlkIG1lZXQiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJncmVlbiIgZ3JhZGllbnRUcmFuc2Zvcm09InJvdGF0ZSg0NSkiPgogICAgICA8c3RvcCBvZmZzZXQ9IjUwJSIgc3RvcC1jb2xvcj0iIzJBQ0Q0RSI+PC9zdG9wPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiM0RUZGQUEiPjwvc3RvcD4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxzdHlsZSB0eXBlPSJ0ZXh0L2NzcyI+CgkJLnBhdGh7ZmlsbDp1cmwoJyNncmVlbicpO30KCTwvc3R5bGU+CiAgPGcgY2xhc3M9InBhdGgiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAuMDAwMDAwLDI1NC4wMDAwMDApIHNjYWxlKDAuMTAwMDAwLC0wLjEwMDAwMCkiIGZpbGw9IiMwMDAwMDAiIHN0cm9rZT0ibm9uZSI+CiAgICA8cGF0aCBkPSJNNDk1IDI1MDQgYy0xODQgLTY1IC0zMzEgLTE4NyAtNDA0IC0zMzUgLTUyIC0xMDUgLTcyIC0yMDMgLTczIC0zNDQgIDAgLTg4IDQgLTEyMyAyMiAtMTc1IDQxIC0xMjIgODkgLTIwMCAxODAgLTI5MSA3MSAtNzIgMTAxIC05NCAxODQgLTEzNSBsOTggIC00OSAxNTIgLTYgYzgzIC00IDQ1OSAtMTEgODM2IC0xNCA2NDMgLTcgNjg5IC05IDc0NSAtMjcgNzkgLTI2IDEzMyAtNTkgMTg4ICAtMTE0IDU4IC02MCA5NCAtMTMxIDExNSAtMjMyIDE5IC05MSAxMCAtMTcyIC0yOSAtMjc2IC00MCAtMTEwIC0xNjkgLTIxNyAgLTMwMyAtMjUyIC00MSAtMTEgLTIxNCAtMTQgLTg5NyAtMTQgbC04NDYgMCAtNjEgMzEgYy05MCA0NCAtMTQwIDExNCAtMTU3ICAyMTUgLTUgMzEgLTIgNDUgMTIgNjIgbDE4IDIxIDkxOSA3IDkxOSA3IDM5IDM1IGMyMSAxOSA0MSA0NSA0NCA1NyA3IDI3IC0xNCAgNzEgLTQ4IDEwMSAtMjMgMjEgLTMxIDIyIC01NDkgMjcgLTI5MCAzIC03NjUgMyAtMTA1OCAwIGwtNTMxIC02IDAgLTE1NyBjMCAgLTE4OSA5IC0yNDIgNTcgLTM0MCA2NCAtMTMyIDE4MyAtMjMwIDMzMiAtMjc0IDQ4IC0xNCAxNTIgLTE2IDkxNSAtMTYgOTY0IDAgIDkzOCAtMSAxMDg0IDcxIDY1IDMyIDEwMiA1OSAxNjUgMTIyIDE0NyAxNDcgMTk3IDI2MyAyMDUgNDc0IDQgMTE3IDIgMTM5IC0xOCAgMjAwIC04NCAyNTQgLTI1MiA0MTYgLTUwMCA0ODIgLTcwIDE4IC0xMjMgMjAgLTczMCAyNiAtMzYwIDQgLTcyNSAxMCAtODEwIDE0ICAtMTQ5IDYgLTE1OSA4IC0yMjEgMzggLTE0OSA3NCAtMjQ5IDIzNyAtMjQ5IDQwNiAwIDE4NSA5MSAzMzYgMjQ4IDQxMyA1NCAyNiAgNjcgMjggMjUyIDM1IDEwNyA0IDUwNiA4IDg4NSA4IGw2OTAgMSA2MCAtMjkgYzcxIC0zNCAxMTYgLTc5IDE0NCAtMTQxIDMwICAtNjkgMzQgLTExMSAxNCAtMTM3IGwtMTggLTIyIC05MTUgLTcgYy0xMDE3IC03IC05NTcgLTMgLTk5MCAtNzYgLTIxIC00OCAtMTMgIC04OSAyNSAtMTI4IGwyNSAtMjUgMTA0NCAwIGM1NzUgMCAxMDQ4IDQgMTA1MyA4IDQgNSA5IDg4IDExIDE4NSA0IDE3MSAzIDE3OSAgLTIyIDI0NyAtMzUgOTAgLTc0IDE1MSAtMTM5IDIxMiAtNjQgNjAgLTEyMiA5NSAtMjA2IDEyMiAtNjMgMjEgLTc5IDIxIC05NTAgIDIxIGwtODg2IC0xIC03MCAtMjV6Ij48L3BhdGg+CiAgPC9nPgo8L3N2Zz4K';
    }

    public function enqueueAdminScripts($connect_suffix, $settings_suffix = null)
    {
        $GLOBALS['smartcloud_wpsuite_menu_parent'] = SMARTCLOUD_WPSUITE_SLUG;
        do_action(SMARTCLOUD_WPSUITE_READY_HOOK, SMARTCLOUD_WPSUITE_SLUG);

        add_action('admin_enqueue_scripts', function ($hook) use ($connect_suffix, $settings_suffix) {
            if ($hook !== $connect_suffix && $hook !== $settings_suffix) {
                return;
            }

            wp_register_script(
                'smartcloud-wpsuite-mantine-vendor',
                SMARTCLOUD_WPSUITE_URL . 'assets/js/mantine-vendor.min.js',
                array(),
                VERSION_MANTINE,
                array('in_footer' => true, 'strategy' => 'defer')
            );

            $script_dependencies = array_merge(
                $this->getAssetDependencies(SMARTCLOUD_WPSUITE_PATH . 'admin.asset.php'),
                array('smartcloud-wpsuite-mantine-vendor')
            );
            wp_enqueue_script('smartcloud-wpsuite-admin-script', SMARTCLOUD_WPSUITE_URL . 'admin.js', array_values(array_unique($script_dependencies)), SMARTCLOUD_WPSUITE_VERSION, array('in_footer' => true, 'strategy' => 'defer'));

            if ($hook === $connect_suffix) {
                $page = 'connect';
            } elseif ($hook === $settings_suffix) {
                $page = 'settings';
            } else {
                $page = '';
            }
            $js = '__wpsuiteGlobal.WpSuite.view = ' . wp_json_encode($page) . ';';
            wp_add_inline_script('smartcloud-wpsuite-admin-script', $js, 'before');

            wp_enqueue_style('smartcloud-wpsuite-admin-style', SMARTCLOUD_WPSUITE_URL . 'admin.css', array(), SMARTCLOUD_WPSUITE_VERSION);
            wp_enqueue_style('smartcloud-wpsuite-mantine-vendor-style', SMARTCLOUD_WPSUITE_URL . 'assets/css/mantine-vendor.css', array(), VERSION_MANTINE);
        });
    }

    /**
     * Check configuration and license.
     */
    public function check(): void
    {
        if ($this->siteSettings->subscriber) {
            // If the site is a subscriber, we need to check if the configuration and the license exist.

            $lock_key = SMARTCLOUD_WPSUITE_SLUG . '/license-refresh-lock';
            $time_key = SMARTCLOUD_WPSUITE_SLUG . '/license-last-refresh';

            /* ---- 1.  handling race-conditions (5-minute lock) ---- */
            if (get_transient($lock_key)) {
                return;
            }
            set_transient($lock_key, 1, 5 * MINUTE_IN_SECONDS);

            /* ---- 2.  do we need to refresh? ---- */
            $need_refresh = false;

            $upload_dir_info = wp_upload_dir();
            $base_dir = trailingslashit($upload_dir_info['basedir']);
            $plugin_subdir = trailingslashit($base_dir . SMARTCLOUD_WPSUITE_SLUG);
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
        echo '<div id="smartcloud-wpsuite-admin"></div>';
    }

    public function initRestApi()
    {
        register_rest_route(
            SMARTCLOUD_WPSUITE_SLUG . '/v1',
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

    public function updateSiteSettings(WP_REST_Request $request)
    {
        $settings_param = json_decode($request->get_body());
        $wpsuite_theme_css = $this->normalizeThemeCssValue($settings_param->wpsuiteThemeCss ?? null);

        if ($settings_param->accountId) {
            $this->siteSettings = new SiteSettings(
                accountId: $settings_param->accountId,
                siteId: $settings_param->siteId,
                lastUpdate: $settings_param->lastUpdate,
                subscriber: $settings_param->subscriber,
                siteKey: $settings_param->siteKey,
                wpsuiteThemeCss: $wpsuite_theme_css,
                reCaptchaPublicKey: $settings_param->reCaptchaPublicKey ?? '',
                useRecaptchaNet: $settings_param->useRecaptchaNet ?? false,
                useRecaptchaEnterprise: $settings_param->useRecaptchaEnterprise ?? false,
                renderRecaptchaProvider: $settings_param->renderRecaptchaProvider ?? true
            );

            update_option(SMARTCLOUD_WPSUITE_SLUG . '/site-settings', $this->siteSettings);
        } else {
            $this->siteSettings = new SiteSettings(
                accountId: '',
                siteId: '',
                lastUpdate: 0,
                subscriber: false,
                siteKey: '',
                wpsuiteThemeCss: $wpsuite_theme_css,
                reCaptchaPublicKey: $settings_param->reCaptchaPublicKey ?? '',
                useRecaptchaNet: $settings_param->useRecaptchaNet ?? false,
                useRecaptchaEnterprise: $settings_param->useRecaptchaEnterprise ?? false,
                renderRecaptchaProvider: $settings_param->renderRecaptchaProvider ?? true
            );
            update_option(SMARTCLOUD_WPSUITE_SLUG . '/site-settings', $this->siteSettings);
        }

        $this->persistWpsuiteThemeCss($wpsuite_theme_css);

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

    private function getHubUploadPaths(): array
    {
        $upload_dir_info = wp_upload_dir();

        return array(
            'dir' => trailingslashit($upload_dir_info['basedir']) . SMARTCLOUD_WPSUITE_SLUG . '/',
            'url' => trailingslashit($upload_dir_info['baseurl']) . SMARTCLOUD_WPSUITE_SLUG . '/',
        );
    }

    private function normalizeThemeCssValue(mixed $value): string
    {
        if (!is_string($value)) {
            return '';
        }

        return str_replace(array("\r\n", "\r"), "\n", trim($value));
    }

    private function sanitizeThemeCssStylesheet(string $css): string
    {
        $css = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/', '', $css);
        if (!is_string($css) || $css === '') {
            return '';
        }

        $css = preg_replace('!/\*.*?\*/!s', '', $css);
        if (!is_string($css) || trim($css) === '') {
            return '';
        }

        $sanitized_rules = array();
        $length = strlen($css);
        $rule_start = 0;
        $block_start = 0;
        $depth = 0;
        $quote = '';
        $prelude = '';

        for ($index = 0; $index < $length; $index++) {
            $char = $css[$index];

            if ($quote !== '') {
                if ($char === '\\') {
                    $index++;
                    continue;
                }

                if ($char === $quote) {
                    $quote = '';
                }

                continue;
            }

            if ($char === '"' || $char === "'") {
                $quote = $char;
                continue;
            }

            if ($char === '{') {
                if ($depth === 0) {
                    $prelude = trim(substr($css, $rule_start, $index - $rule_start));
                    $block_start = $index + 1;
                }

                $depth++;
                continue;
            }

            if ($char === '}') {
                if ($depth === 0) {
                    continue;
                }

                $depth--;
                if ($depth !== 0) {
                    continue;
                }

                $body = substr($css, $block_start, $index - $block_start);
                $sanitized_rule = $this->sanitizeThemeCssRule($prelude, $body);
                if ($sanitized_rule !== '') {
                    $sanitized_rules[] = $sanitized_rule;
                }

                $rule_start = $index + 1;
                $prelude = '';
                continue;
            }

            if ($char === ';' && $depth === 0) {
                $rule_start = $index + 1;
            }
        }

        return trim(implode("\n\n", $sanitized_rules));
    }

    private function sanitizeThemeCssRule(string $prelude, string $body): string
    {
        $prelude = $this->sanitizeThemeCssPrelude($prelude);
        if ($prelude === '') {
            return '';
        }

        $lower_prelude = strtolower($prelude);
        if ($this->isThemeCssContainerAtRule($lower_prelude)) {
            $sanitized_body = $this->sanitizeThemeCssStylesheet($body);
            if ($sanitized_body === '') {
                return '';
            }

            return $prelude . " {\n" . $sanitized_body . "\n}";
        }

        $sanitized_body = $this->sanitizeThemeCssDeclarationBlock($body);
        if ($sanitized_body === '') {
            return '';
        }

        return $prelude . " {\n  " . $sanitized_body . "\n}";
    }

    private function sanitizeThemeCssPrelude(string $prelude): string
    {
        $prelude = preg_replace('/[\x00-\x1F\x7F]+/', ' ', trim($prelude));
        if (!is_string($prelude) || $prelude === '') {
            return '';
        }

        $prelude = preg_replace('/\s+/', ' ', $prelude);
        if (!is_string($prelude) || $prelude === '') {
            return '';
        }

        if (str_contains($prelude, '{') || str_contains($prelude, '}') || str_contains($prelude, ';')) {
            return '';
        }

        $lower_prelude = strtolower($prelude);
        if (str_starts_with($lower_prelude, '@import') || str_starts_with($lower_prelude, '@charset') || str_starts_with($lower_prelude, '@namespace')) {
            return '';
        }

        if (
            str_starts_with($lower_prelude, '@')
            && !$this->isThemeCssContainerAtRule($lower_prelude)
            && !str_starts_with($lower_prelude, '@font-face')
        ) {
            return '';
        }

        return $prelude;
    }

    private function isThemeCssContainerAtRule(string $prelude): bool
    {
        foreach (array('@media', '@supports', '@container', '@layer', '@keyframes', '@-webkit-keyframes', '@-moz-keyframes', '@-o-keyframes') as $prefix) {
            if (str_starts_with($prelude, $prefix)) {
                return true;
            }
        }

        return false;
    }

    private function sanitizeThemeCssDeclarationBlock(string $declarations): string
    {
        $declarations = trim($declarations);
        if ($declarations === '') {
            return '';
        }

        if (!function_exists('safecss_filter_attr')) {
            return sanitize_textarea_field($declarations);
        }

        $sanitized = safecss_filter_attr($declarations);
        if (!is_string($sanitized)) {
            return '';
        }

        $sanitized = trim($sanitized);
        if ($sanitized === '') {
            return '';
        }

        return rtrim(str_replace("\n", "\n  ", $sanitized), ';') . ';';
    }

    private function persistWpsuiteThemeCss(string $css): void
    {
        $upload_paths = $this->getHubUploadPaths();
        $css_path = $upload_paths['dir'] . WPSUITE_THEME_CSS_FILENAME;
        $sanitized_css = $this->sanitizeThemeCssStylesheet($css);

        if ($sanitized_css === '') {
            if (file_exists($css_path)) {
                wp_delete_file($css_path);
            }
            return;
        }

        wp_mkdir_p($upload_paths['dir']);
        file_put_contents($css_path, $sanitized_css);
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
                    $plugin_subdir = trailingslashit($base_dir . SMARTCLOUD_WPSUITE_SLUG);

                    wp_mkdir_p($plugin_subdir);

                    $config_path = $plugin_subdir . 'config.enc';
                    $jws_path = $plugin_subdir . 'lic.jws';

                    // Biztonságosabb fájl-írás WP_Filesystem-mel, de röviden:
                    file_put_contents($config_path, sanitize_text_field($data['config']));
                    file_put_contents($jws_path, sanitize_text_field($data['jws']));

                    update_option(SMARTCLOUD_WPSUITE_SLUG . '/license-last-refresh', time());
                }
            }
        }
    }

    private function deleteConfig()
    {
        $upload_dir_info = wp_upload_dir();
        $base_dir = trailingslashit($upload_dir_info['basedir']);
        $plugin_subdir = trailingslashit($base_dir . SMARTCLOUD_WPSUITE_SLUG);

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