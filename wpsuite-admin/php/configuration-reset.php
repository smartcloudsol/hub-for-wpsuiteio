<?php

namespace SmartCloud\WPSuite\Hub;

if (!defined('ABSPATH')) { exit; }

/** Explicit, plugin-owned configuration reset. Never infer ownership from a prefix. */
final class ConfigurationReset
{
    public function registerRoutes(): void
    {
        register_rest_route('smartcloud-wpsuite/v1', '/admin-resets/(?P<id>[a-z][a-z0-9-]{0,63})', array(
            array('methods' => 'GET', 'callback' => array($this, 'read'), 'permission_callback' => array($this, 'permission')),
            array('methods' => 'POST', 'callback' => array($this, 'reset'), 'permission_callback' => array($this, 'permission')),
        ));
    }

    public function permission(\WP_REST_Request $request): bool|\WP_Error
    {
        $provider = $this->provider((string) $request['id']);
        return is_wp_error($provider) ? $provider : true;
    }

    private function provider(string $id): array|\WP_Error
    {
        $found = null;
        foreach (apply_filters('smartcloud_wpsuite_admin_capabilities', array()) as $entry) {
            if (!is_array($entry) || ($entry['schema_version'] ?? null) !== 1 || ($entry['id'] ?? '') !== $id) { continue; }
            if ($found !== null && $found !== $entry) { return self::error('reset_conflict', 'This tool has conflicting registrations.', 409); }
            $found = $entry;
        }
        if ($found === null || !is_array($found['configuration_reset'] ?? null)) {
            return self::error('reset_unavailable', 'Configuration reset is not available for this plugin.', 404);
        }
        if (!current_user_can('manage_options') || !current_user_can($found['required_capability'] ?? 'manage_options')) {
            return self::error('reset_forbidden', 'You do not have permission to reset this plugin.', 403);
        }
        $reset = $found['configuration_reset'];
        if (!is_array($reset['options'] ?? null) || count($reset['options']) > 64 || !is_string($reset['title'] ?? null)
            || strlen($reset['title']) > 256) { return self::failed(); }
        foreach ($reset['options'] as $key) {
            // The descriptor owns this exact list; no patterns, SQL or shared Hub state.
            if (!is_string($key) || !preg_match('/^[a-zA-Z0-9_-]{1,191}$/D', $key)
                || str_starts_with($key, 'smartcloud-wpsuite') || str_starts_with($key, 'hub-for-wpsuiteio')) { return self::failed(); }
        }
        foreach (array('consequences', 'preserved') as $key) {
            if (!is_array($reset[$key] ?? null) || count($reset[$key]) > 16) { return self::failed(); }
            foreach ($reset[$key] as $text) { if (!is_string($text) || strlen($text) > 2048) { return self::failed(); } }
        }
        foreach (array('revision', 'reset') as $key) {
            if (isset($reset[$key]) && !is_callable($reset[$key])) { return self::failed(); }
        }
        return $reset;
    }

    public function read(\WP_REST_Request $request): array|\WP_Error
    {
        try {
            $reset = $this->provider((string) $request['id']);
            if (is_wp_error($reset)) { return $reset; }
            return array('schema_version' => 1, 'revision' => $this->revision($reset), 'title' => $reset['title'],
                'consequences' => array_values($reset['consequences']), 'preserved' => array_values($reset['preserved']));
        } catch (\Throwable $error) { return self::failed(); }
    }

    public function reset(\WP_REST_Request $request): array|\WP_Error
    {
        global $wpdb;
        $reset = $this->provider((string) $request['id']);
        if (is_wp_error($reset)) { return $reset; }
        // Cookie authentication also checks this nonce; require it explicitly for this destructive operation.
        if (!wp_verify_nonce($request->get_header('X-WP-Nonce'), 'wp_rest')) {
            return self::error('reset_nonce', 'Reload the page before resetting settings.', 403);
        }
        $body = $request->get_json_params();
        if (!is_array($body) || count($body) !== 2 || array_diff(array_keys($body), array('revision', 'confirm'))
            || ($body['confirm'] ?? null) !== true || !is_string($body['revision'] ?? null)
            || !preg_match('/^[a-f0-9]{64}$/D', $body['revision'])) {
            return self::error('reset_confirmation', 'Review and explicitly confirm the complete configuration reset.', 400);
        }
        // A connection-owned lock is released even if PHP terminates unexpectedly.
        $lock = 'wpsuite-reset-' . substr(hash('sha256', $wpdb->options . ':' . $request['id']), 0, 40);
        if ((string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock)) !== '1') {
            return self::error('reset_busy', 'Another configuration reset is in progress. Try again shortly.', 409);
        }
        try {
            if (!hash_equals($this->revision($reset), $body['revision'])) {
                return self::error('reset_stale', 'Settings changed after you opened the confirmation. Close it and review the reset again.', 409);
            }
            $result = isset($reset['reset']) ? ($reset['reset'])($body['revision']) : $this->resetOptions($reset, $body['revision']);
            if (is_wp_error($result)) { return $result; }
            return $result === true ? array('reset' => true, 'reload_required' => true) : self::failed();
        } catch (\Throwable $error) { return self::failed(); }
        finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); }
    }

    public static function revision(array $reset): string
    {
        $extra = isset($reset['revision']) ? ($reset['revision'])() : null;
        if (is_wp_error($extra)) { throw new \RuntimeException('Reset revision unavailable'); }
        return hash_hmac('sha256', serialize(array(self::optionRevision($reset['options']), $extra)), wp_salt('nonce'));
    }

    /** Ordinary native option updates also obey these row locks. */
    private function resetOptions(array $reset, string $revision): bool|\WP_Error
    {
        global $wpdb;
        if ($wpdb->query('START TRANSACTION') === false) { return self::failed(); }
        $committed = false;
        try {
            $keys = $reset['options'];
            sort($keys, SORT_STRING);
            foreach ($keys as $key) {
                $wpdb->get_row($wpdb->prepare("SELECT option_id FROM {$wpdb->options} WHERE option_name = %s FOR UPDATE", $key));
                if ($wpdb->last_error) { return self::failed(); }
            }
            if (!hash_equals(self::revision($reset), $revision)) {
                return self::error('reset_stale', 'Settings changed after you opened the confirmation. Close it and review the reset again.', 409);
            }
            $result = self::deleteOptions($keys, false);
            if (is_wp_error($result)) { return $result; }
            if ($wpdb->query('COMMIT') === false) { return self::failed(); }
            $committed = true;
            return true;
        } finally {
            if (!$committed) { $wpdb->query('ROLLBACK'); }
            foreach ($reset['options'] as $key) { wp_cache_delete($key, 'options'); }
            wp_cache_delete('alloptions', 'options');
            wp_cache_delete('notoptions', 'options');
        }
    }

    /** Read the database, not an admin singleton or a persistent option cache. */
    public static function optionRevision(array $keys): string
    {
        global $wpdb;
        sort($keys, SORT_STRING);
        $state = array();
        foreach ($keys as $key) {
            $row = $wpdb->get_row($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $key), ARRAY_A);
            if ($wpdb->last_error) { throw new \RuntimeException('Configuration unavailable'); }
            $state[$key] = $row;
        }
        return hash_hmac('sha256', serialize($state), wp_salt('nonce'));
    }

    /** Custom adapters with their own transaction must pass false. */
    public static function deleteOptions(array $keys, bool $transaction = true): bool|\WP_Error
    {
        global $wpdb;
        if ($transaction && $wpdb->query('START TRANSACTION') === false) { return self::failed(); }
        try {
            foreach ($keys as $key) {
                // delete_option invokes only normal option lifecycle hooks, never product save/publish operations.
                wp_cache_delete($key, 'options');
                wp_cache_delete('alloptions', 'options');
                delete_option($key);
                if ($wpdb->get_var($wpdb->prepare("SELECT option_id FROM {$wpdb->options} WHERE option_name = %s", $key)) !== null
                    || $wpdb->last_error) { throw new \RuntimeException('Configuration reset failed'); }
            }
            if ($transaction && $wpdb->query('COMMIT') === false) { throw new \RuntimeException('Configuration reset failed'); }
            return true;
        } catch (\Throwable $error) {
            if ($transaction) { $wpdb->query('ROLLBACK'); }
            return self::failed();
        } finally {
            foreach ($keys as $key) { wp_cache_delete($key, 'options'); }
            wp_cache_delete('alloptions', 'options');
            wp_cache_delete('notoptions', 'options');
        }
    }

    private static function failed(): \WP_Error
    {
        return self::error('reset_failed', 'The plugin could not complete the configuration reset. Reload and check its settings before trying again.', 500);
    }

    private static function error(string $code, string $message, int $status): \WP_Error
    {
        return new \WP_Error($code, __($message, 'smartcloud-wpsuite'), array('status' => $status));
    }
}
