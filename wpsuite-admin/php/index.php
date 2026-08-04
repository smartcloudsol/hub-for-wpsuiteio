<?php
/**
 * Admin class to create settings page and  REST API endpoint to handle parameter updates coming from the settings front-end,
 * and load the settings.
 *
 */

namespace SmartCloud\WPSuite\Hub;

use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}
if (file_exists(filename: SMARTCLOUD_WPSUITE_PATH . 'model.php')) {
    require_once SMARTCLOUD_WPSUITE_PATH . 'model.php';
}
if (
    !class_exists('\\SmartCloud\\WPSuite\\Hub\\Abilities\\Product_Provider_Base', false)
    && file_exists(filename: SMARTCLOUD_WPSUITE_PATH . 'abilities.php')
) {
    require_once SMARTCLOUD_WPSUITE_PATH . 'abilities.php';
}

const VERSION_WEBCRYPTO = '1.1.5';
const VERSION_AMPLIFY = '1.1.6';
const VERSION_MANTINE = '1.0.8';
const WPSUITE_CUSTOM_CSS_STYLESHEET = 'smartcloud-wpsuiteio-theme';
const WPSUITE_CUSTOM_CSS_SECTION = 'smartcloud_wpsuiteio_theme_css';
const WPSUITE_VIRTUAL_ASSET_PATH = 'smartcloud-wpsuiteio';
const WPSUITE_VIRTUAL_ASSET_QUERY_VAR = 'smartcloud_wpsuiteio_asset';
const WPSUITE_VIRTUAL_ASSET_REWRITE_VERSION = '1';
const WPSUITE_LICENSE_OPTION = 'smartcloud-wpsuiteio/license-jws';
const WPSUITE_CONFIG_OPTION = 'smartcloud-wpsuiteio/config-encrypted';
const WPSUITE_LICENSE_REFRESH_OPTION = 'smartcloud-wpsuiteio/license-last-refresh';
const WPSUITE_LICENSE_REFRESH_LOCK = 'smartcloud-wpsuiteio/license-refresh-lock';
const WPSUITE_NAMESPACE_MIGRATION_OPTION = 'smartcloud-wpsuite/namespace-migration-version';
const WPSUITE_NAMESPACE_MIGRATION_VERSION = '1';

class HubAdmin
{
    private SiteSettings $siteSettings;
    private string $legacyThemeCss = '';

    public function __construct()
    {
        $this->migrateLegacyNamespaceOptions();
        $defaultSiteSettings = new SiteSettings(
            accountId: '',
            siteId: '',
            lastUpdate: 0,
            subscriber: false,
            siteKey: '',
            reCaptchaPublicKey: '',
            useRecaptchaNet: false,
            useRecaptchaEnterprise: false,
            renderRecaptchaProvider: true,
        );
        $stored = get_option(SMARTCLOUD_WPSUITE_CANONICAL_SLUG . '/site-settings', $defaultSiteSettings);
        $values = is_object($stored) ? get_object_vars($stored) : (is_array($stored) ? $stored : array());
        $this->legacyThemeCss = $this->normalizeThemeCssValue($values['wpsuiteThemeCss'] ?? '');
        $this->siteSettings = new SiteSettings(
            accountId: (string) ($values['accountId'] ?? ''),
            siteId: (string) ($values['siteId'] ?? ''),
            lastUpdate: (int) ($values['lastUpdate'] ?? 0),
            subscriber: (bool) ($values['subscriber'] ?? false),
            siteKey: (string) ($values['siteKey'] ?? ''),
            reCaptchaPublicKey: (string) ($values['reCaptchaPublicKey'] ?? ''),
            useRecaptchaNet: (bool) ($values['useRecaptchaNet'] ?? false),
            useRecaptchaEnterprise: (bool) ($values['useRecaptchaEnterprise'] ?? false),
            renderRecaptchaProvider: (bool) ($values['renderRecaptchaProvider'] ?? true),
        );
        $this->registerRestRoutes();
    }

    public function init(): void
    {
        // HubAdmin::init() itself runs on WordPress' init hook. Registering a
        // second init callback here would be too late for the current request,
        // so install the rule immediately before request parsing begins.
        $this->registerVirtualAssetRewrite();
        add_filter('query_vars', array($this, 'registerVirtualAssetQueryVar'));
        // Serve file-like virtual URLs before redirect_canonical() can append
        // the site's trailing slash and turn every asset load into two requests.
        add_action('template_redirect', array($this, 'serveVirtualAsset'), 0);
        add_action('customize_register', array($this, 'registerThemeCssCustomizer'));
        add_action('admin_init', array($this, 'migrateLegacyStorage'));
        add_action('admin_menu', array($this, 'mergeLegacyAdminMenu'), PHP_INT_MAX);
        add_filter('smartcloud_wpsuite_theme_css_url', array($this, 'filterThemeCssUrl'));
        add_action('wp_head', array($this, 'addMainScript', ), 1);
        add_action('admin_head', array($this, 'addMainScript'), 1);

        // Front‑end assets + shortcodes
        add_action('wp_enqueue_scripts', array($this, 'enqueueScripts', ), 10);
        add_action('admin_init', array($this, 'enqueueScripts'), 10);
        add_action('elementor/preview/after_enqueue_scripts', array($this, 'enqueueScripts'), 10);

    }

    public function registerVirtualAssetRewrite(): void
    {
        add_rewrite_rule(
            '^' . WPSUITE_VIRTUAL_ASSET_PATH . '/(theme\.css|lic\.jws|config\.enc)/?$',
            'index.php?' . WPSUITE_VIRTUAL_ASSET_QUERY_VAR . '=$matches[1]',
            'top'
        );

        $rewrite_option = 'smartcloud-wpsuiteio/asset-rewrite-version';
        if (get_option($rewrite_option) !== WPSUITE_VIRTUAL_ASSET_REWRITE_VERSION) {
            flush_rewrite_rules(false);
            update_option($rewrite_option, WPSUITE_VIRTUAL_ASSET_REWRITE_VERSION, false);
        }
    }

    /**
     * @param string[] $query_vars Public WordPress query variables.
     * @return string[]
     */
    public function registerVirtualAssetQueryVar(array $query_vars): array
    {
        $query_vars[] = WPSUITE_VIRTUAL_ASSET_QUERY_VAR;
        return $query_vars;
    }

    public function registerThemeCssCustomizer(\WP_Customize_Manager $wp_customize): void
    {
        $wp_customize->add_section(
            WPSUITE_CUSTOM_CSS_SECTION,
            array(
                'title' => __('WP Suite Theme CSS', 'smartcloud-wpsuite'),
                'description' => __('CSS saved by WordPress and loaded inside WP Suite component style scopes.', 'smartcloud-wpsuite'),
                'priority' => 200,
            )
        );

        $setting_id = 'custom_css[' . WPSUITE_CUSTOM_CSS_STYLESHEET . ']';
        $setting = new \WP_Customize_Custom_CSS_Setting(
            $wp_customize,
            $setting_id,
            array(
                'capability' => 'edit_css',
                'transport' => 'refresh',
            )
        );
        $wp_customize->add_setting($setting);
        $wp_customize->add_control(
            new \WP_Customize_Code_Editor_Control(
                $wp_customize,
                $setting_id,
                array(
                    'label' => __('WP Suite Theme CSS', 'smartcloud-wpsuite'),
                    'description' => __('Shared CSS for WP Suite components. WordPress validates the stylesheet before it is saved.', 'smartcloud-wpsuite'),
                    'section' => WPSUITE_CUSTOM_CSS_SECTION,
                    'settings' => $setting_id,
                    'code_type' => 'text/css',
                )
            )
        );
    }

    public function migrateLegacyStorage(): void
    {
        if (!current_user_can('edit_css')) {
            return;
        }

        $current_css = wp_get_custom_css(WPSUITE_CUSTOM_CSS_STYLESHEET);
        $migration_css = $this->getLegacyThemeCssForMigration();
        if ($current_css === '' && $migration_css !== '') {
            $result = wp_update_custom_css_post(
                $migration_css,
                array('stylesheet' => WPSUITE_CUSTOM_CSS_STYLESHEET)
            );
            if (is_wp_error($result)) {
                return;
            }
        }

        $stored = get_option(SMARTCLOUD_WPSUITE_CANONICAL_SLUG . '/site-settings');
        $values = is_object($stored) ? get_object_vars($stored) : (is_array($stored) ? $stored : array());
        if (array_key_exists('wpsuiteThemeCss', $values)) {
            $this->writeSiteSettingsOptions($this->siteSettings);
        }

        if ($this->siteSettings->subscriber) {
            $this->migrateLegacyLicenseFiles();
        }
    }

    private function getLegacyThemeCssForMigration(): string
    {
        $upload_dir = wp_upload_dir();
        if (empty($upload_dir['error'])) {
            $legacy_file = trailingslashit($upload_dir['basedir'])
                . SMARTCLOUD_WPSUITE_LEGACY_SLUG
                . '/wpsuite-theme.css';
            if (is_readable($legacy_file)) {
                $file_css = $this->normalizeThemeCssValue(file_get_contents($legacy_file));
                if ($file_css !== '') {
                    return $file_css;
                }
            }
        }

        // The old option retained the unsanitized editor value. Reject markup
        // during the one-time fallback migration instead of bypassing the core
        // CSS setting's normal save validation.
        if (str_contains($this->legacyThemeCss, '<')) {
            return '';
        }

        return $this->legacyThemeCss;
    }

    public function serveVirtualAsset(): void
    {
        $asset = (string) get_query_var(WPSUITE_VIRTUAL_ASSET_QUERY_VAR, '');
        $asset = strtok($asset, '?') ?: '';
        if (!in_array($asset, array('theme.css', 'lic.jws', 'config.enc'), true)) {
            return;
        }

        if ($asset === 'theme.css') {
            $content = wp_get_custom_css(WPSUITE_CUSTOM_CSS_STYLESHEET);
            $content_type = 'text/css; charset=UTF-8';
            $cache_control = 'public, max-age=300, must-revalidate';
        } elseif ($asset === 'lic.jws') {
            $content = get_option(WPSUITE_LICENSE_OPTION, '');
            $content_type = 'application/jose';
            $cache_control = 'private, no-cache, must-revalidate';
        } else {
            $content = get_option(WPSUITE_CONFIG_OPTION, '');
            $content_type = 'text/plain; charset=UTF-8';
            $cache_control = 'private, no-cache, must-revalidate';
        }

        if (!is_string($content) || ($asset !== 'theme.css' && $content === '')) {
            status_header(404);
            nocache_headers();
            exit;
        }

        $etag = '"' . hash('sha256', $content) . '"';
        $request_etag = isset($_SERVER['HTTP_IF_NONE_MATCH'])
            ? sanitize_text_field(wp_unslash($_SERVER['HTTP_IF_NONE_MATCH']))
            : '';
        if (hash_equals($etag, $request_etag)) {
            status_header(304);
            header('ETag: ' . $etag);
            exit;
        }

        status_header(200);
        header('Content-Type: ' . $content_type);
        header('Content-Length: ' . strlen($content));
        header('Content-Disposition: inline; filename="' . $asset . '"');
        header('Cache-Control: ' . $cache_control);
        header('ETag: ' . $etag);
        header('X-Content-Type-Options: nosniff');
        echo $content; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Raw virtual asset response.
        exit;
    }

    /**
     * Add inline scripts that expose PHP constants to JS.
     */
    public function addMainScript(): void
    {
        $data = array(
            'restUrl' => rest_url(SMARTCLOUD_WPSUITE_CANONICAL_SLUG . '/v1'),
            'uploadUrl' => $this->getVirtualAssetBaseUrl(),
            'nonce' => wp_create_nonce('wp_rest'),
            'themeCssEditorUrl' => current_user_can('edit_css')
                ? add_query_arg('autofocus[section]', WPSUITE_CUSTOM_CSS_SECTION, admin_url('customize.php'))
                : '',
            'siteSettings' => array(
                'accountId' => $this->siteSettings->accountId,
                'siteId' => $this->siteSettings->siteId,
                'siteKey' => is_admin() && current_user_can('manage_options') ? $this->siteSettings->siteKey : '',
                'lastUpdate' => $this->siteSettings->lastUpdate,
                'subscriber' => $this->siteSettings->subscriber,
                'reCaptchaPublicKey' => $this->siteSettings->reCaptchaPublicKey,
                'useRecaptchaNet' => $this->siteSettings->useRecaptchaNet,
                'useRecaptchaEnterprise' => $this->siteSettings->useRecaptchaEnterprise,
                'renderRecaptchaProvider' => $this->siteSettings->renderRecaptchaProvider,
                'hubInstalled' => true,
            ),
        );
        $encoded_data = wp_json_encode(
            $data,
            JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
        );
        if (!is_string($encoded_data)) {
            $encoded_data = '{}';
        }

        $js = 'const __wpsuiteGlobal = (typeof globalThis !== "undefined") ? globalThis : window;
__wpsuiteGlobal.WpSuite = __wpsuiteGlobal.WpSuite ?? {};
__wpsuiteGlobal.WpSuite.plugins = __wpsuiteGlobal.WpSuite.plugins ?? {};
__wpsuiteGlobal.WpSuite.events = __wpsuiteGlobal.WpSuite.events ?? {
  emit: function (type, detail) { window.dispatchEvent(new CustomEvent(type, { detail })); },
  on: function (type, cb, opts) { window.addEventListener(type, cb, opts); },
};
Object.assign(__wpsuiteGlobal.WpSuite, ' . $encoded_data . ');
// backward compatibility
var WpSuite = __wpsuiteGlobal.WpSuite;
';
        // The data is JSON-encoded with HTML-significant characters escaped.
        // KSES must not process JavaScript because it corrupts valid CSS selectors
        // embedded in the site settings and can turn this whole bootstrap invalid.
        wp_print_inline_script_tag($js);
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
        $GLOBALS['smartcloud_wpsuite_menu_parent'] = SMARTCLOUD_WPSUITE_CANONICAL_SLUG;
        do_action(SMARTCLOUD_WPSUITE_READY_HOOK, SMARTCLOUD_WPSUITE_CANONICAL_SLUG);
        do_action(SMARTCLOUD_WPSUITE_LEGACY_SLUG . '/ready', SMARTCLOUD_WPSUITE_CANONICAL_SLUG);

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

            /* ---- 1.  handling race-conditions (5-minute lock) ---- */
            if (get_transient(WPSUITE_LICENSE_REFRESH_LOCK)) {
                return;
            }
            set_transient(WPSUITE_LICENSE_REFRESH_LOCK, 1, 5 * MINUTE_IN_SECONDS);

            /* ---- 2.  do we need to refresh? ---- */
            $need_refresh = false;

            $stored_config = get_option(WPSUITE_CONFIG_OPTION, false);
            $stored_license = get_option(WPSUITE_LICENSE_OPTION, false);
            $exists = is_string($stored_config) && $stored_config !== ''
                && is_string($stored_license) && $stored_license !== '';

            if (!$exists) {
                $need_refresh = true;
            }

            // 2/b) was the last successful refresh more than a week ago?
            $last = (int) get_option(WPSUITE_LICENSE_REFRESH_OPTION, 0);
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
            delete_transient(WPSUITE_LICENSE_REFRESH_LOCK);
        }
    }

    public function renderAdminPage()
    {
        echo '<div id="smartcloud-wpsuite-admin"></div>';
    }

    public function renderLegacyAdminPage(): void
    {
        wp_safe_redirect(admin_url('admin.php?page=' . SMARTCLOUD_WPSUITE_CANONICAL_SLUG));
        exit;
    }

    public function mergeLegacyAdminMenu(): void
    {
        global $submenu;

        if (isset($submenu[SMARTCLOUD_WPSUITE_LEGACY_SLUG]) && is_array($submenu[SMARTCLOUD_WPSUITE_LEGACY_SLUG])) {
            $canonical = is_array($submenu[SMARTCLOUD_WPSUITE_CANONICAL_SLUG] ?? null)
                ? $submenu[SMARTCLOUD_WPSUITE_CANONICAL_SLUG]
                : array();
            foreach ($submenu[SMARTCLOUD_WPSUITE_LEGACY_SLUG] as $item) {
                if (!in_array($item, $canonical, true)) {
                    $canonical[] = $item;
                }
            }
            $submenu[SMARTCLOUD_WPSUITE_CANONICAL_SLUG] = $canonical;
            unset($submenu[SMARTCLOUD_WPSUITE_LEGACY_SLUG]);
        }

        remove_menu_page(SMARTCLOUD_WPSUITE_LEGACY_SLUG);
    }

    public function initRestApi()
    {
        $route = array(
                'methods' => 'POST',
                'callback' => array($this, 'updateSiteSettings'),
                'permission_callback' => function () {
                    if (!current_user_can('manage_options')) {
                        return new WP_Error('rest_forbidden', 'Forbidden', array('status' => 403));
                    }
                    return true;
                },
            );
        register_rest_route(SMARTCLOUD_WPSUITE_CANONICAL_SLUG . '/v1', '/update-site-settings', $route);
        register_rest_route(SMARTCLOUD_WPSUITE_LEGACY_SLUG . '/v1', '/update-site-settings', $route);
    }

    public function updateSiteSettings(WP_REST_Request $request)
    {
        $settings_param = json_decode($request->get_body());
        if (!is_object($settings_param)) {
            return new WP_Error('wpsuite_invalid_settings', 'The settings payload must be a JSON object.', array('status' => 400));
        }

        if (!empty($settings_param->accountId)) {
            $this->siteSettings = new SiteSettings(
                accountId: sanitize_text_field((string) $settings_param->accountId),
                siteId: sanitize_text_field((string) ($settings_param->siteId ?? '')),
                lastUpdate: (int) ($settings_param->lastUpdate ?? 0),
                subscriber: (bool) ($settings_param->subscriber ?? false),
                siteKey: sanitize_text_field((string) ($settings_param->siteKey ?? '')),
                reCaptchaPublicKey: sanitize_text_field((string) ($settings_param->reCaptchaPublicKey ?? '')),
                useRecaptchaNet: (bool) ($settings_param->useRecaptchaNet ?? false),
                useRecaptchaEnterprise: (bool) ($settings_param->useRecaptchaEnterprise ?? false),
                renderRecaptchaProvider: (bool) ($settings_param->renderRecaptchaProvider ?? true)
            );

            $this->writeSiteSettingsOptions($this->siteSettings);
        } else {
            $this->siteSettings = new SiteSettings(
                accountId: '',
                siteId: '',
                lastUpdate: 0,
                subscriber: false,
                siteKey: '',
                reCaptchaPublicKey: sanitize_text_field((string) ($settings_param->reCaptchaPublicKey ?? '')),
                useRecaptchaNet: (bool) ($settings_param->useRecaptchaNet ?? false),
                useRecaptchaEnterprise: (bool) ($settings_param->useRecaptchaEnterprise ?? false),
                renderRecaptchaProvider: (bool) ($settings_param->renderRecaptchaProvider ?? true)
            );
            $this->writeSiteSettingsOptions($this->siteSettings);
        }

        if ($this->siteSettings->subscriber) {
            $this->reloadConfig(
                $this->siteSettings->accountId,
                $this->siteSettings->siteId,
                $this->siteSettings->siteKey
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

    private function migrateLegacyNamespaceOptions(): void
    {
        $canonical_key = SMARTCLOUD_WPSUITE_CANONICAL_SLUG . '/site-settings';
        $legacy_key = SMARTCLOUD_WPSUITE_LEGACY_SLUG . '/site-settings';
        $canonical = get_option($canonical_key, null);
        $legacy = get_option($legacy_key, null);

        if ($canonical === null && $legacy !== null) {
            update_option($canonical_key, $legacy, false);
        }
        update_option(WPSUITE_NAMESPACE_MIGRATION_OPTION, WPSUITE_NAMESPACE_MIGRATION_VERSION, false);
    }

    private function writeSiteSettingsOptions(SiteSettings $settings): void
    {
        update_option(SMARTCLOUD_WPSUITE_CANONICAL_SLUG . '/site-settings', $settings, false);
        update_option(SMARTCLOUD_WPSUITE_LEGACY_SLUG . '/site-settings', $settings, false);
    }

    private function getVirtualAssetBaseUrl(): string
    {
        if ((string) get_option('permalink_structure', '') !== '') {
            return trailingslashit(home_url('/' . WPSUITE_VIRTUAL_ASSET_PATH));
        }

        return home_url('/?' . WPSUITE_VIRTUAL_ASSET_QUERY_VAR . '=');
    }

    public function getThemeCssUrl(): ?string
    {
        $css = wp_get_custom_css(WPSUITE_CUSTOM_CSS_STYLESHEET);
        if ($css === '') {
            return null;
        }

        return add_query_arg(
            'ver',
            substr(hash('sha256', $css), 0, 12),
            $this->getVirtualAssetBaseUrl() . 'theme.css'
        );
    }

    public function filterThemeCssUrl(mixed $url): ?string
    {
        return $this->getThemeCssUrl();
    }

    private function normalizeThemeCssValue(mixed $value): string
    {
        if (!is_string($value)) {
            return '';
        }

        return str_replace(array("\r\n", "\r"), "\n", trim($value));
    }

    private function reloadConfig(string $accountId, string $siteId, string $siteKey): bool
    {
        $api_base = 'https://api.wpsuite.io';

        // Ha a WordPress-URL tartalmazza a dev-domaint, akkor /dev-et fűzünk hozzá
        if (strpos(get_site_url(), 'dev.wpsuite.io') !== false) {
            $api_base .= '/dev';
        }

        $endpoint = sprintf(
            '%s/account/%s/site/%s/license',
            $api_base,
            rawurlencode($accountId),
            rawurlencode($siteId)
        );

        $args = [
            'headers' => [
                'Accept' => 'application/json',
                'X-Site-Key' => $siteKey,
            ],
            'timeout' => 10,
        ];

        $response = wp_remote_get($endpoint, $args);

        if (is_wp_error($response) || 200 !== wp_remote_retrieve_response_code($response)) {
            return false;
        }

        $data = json_decode(wp_remote_retrieve_body($response), true);
        $config = is_array($data) ? trim((string) ($data['config'] ?? '')) : '';
        $jws = is_array($data) ? trim((string) ($data['jws'] ?? '')) : '';
        if (!$this->isValidEncryptedConfig($config) || !$this->isValidCompactJws($jws)) {
            return false;
        }

        update_option(WPSUITE_CONFIG_OPTION, $config, false);
        update_option(WPSUITE_LICENSE_OPTION, $jws, false);
        update_option(WPSUITE_LICENSE_REFRESH_OPTION, time(), false);
        return true;
    }

    private function deleteConfig(): void
    {
        delete_option(WPSUITE_CONFIG_OPTION);
        delete_option(WPSUITE_LICENSE_OPTION);
        delete_option(WPSUITE_LICENSE_REFRESH_OPTION);
    }

    private function isValidCompactJws(string $value): bool
    {
        return (bool) preg_match('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/', $value);
    }

    private function isValidEncryptedConfig(string $value): bool
    {
        return (bool) preg_match('/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/', $value);
    }

    private function migrateLegacyLicenseFiles(): void
    {
        if (get_option(WPSUITE_CONFIG_OPTION, '') !== '' && get_option(WPSUITE_LICENSE_OPTION, '') !== '') {
            return;
        }

        $upload_dir = wp_upload_dir();
        if (!empty($upload_dir['error'])) {
            return;
        }

        $legacy_dir = trailingslashit($upload_dir['basedir']) . SMARTCLOUD_WPSUITE_LEGACY_SLUG . '/';
        $config = is_readable($legacy_dir . 'config.enc')
            ? trim((string) file_get_contents($legacy_dir . 'config.enc'))
            : '';
        $jws = is_readable($legacy_dir . 'lic.jws')
            ? trim((string) file_get_contents($legacy_dir . 'lic.jws'))
            : '';
        if (!$this->isValidEncryptedConfig($config) || !$this->isValidCompactJws($jws)) {
            return;
        }

        update_option(WPSUITE_CONFIG_OPTION, $config, false);
        update_option(WPSUITE_LICENSE_OPTION, $jws, false);
        $legacy_refresh = (int) get_option(SMARTCLOUD_WPSUITE_LEGACY_SLUG . '/license-last-refresh', time());
        update_option(WPSUITE_LICENSE_REFRESH_OPTION, $legacy_refresh, false);
    }

}
