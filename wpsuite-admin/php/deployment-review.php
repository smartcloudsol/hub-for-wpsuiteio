<?php
namespace SmartCloud\WPSuite\Hub;

if (!defined('ABSPATH')) exit;

/** One site-wide decision for each deployment candidate batch. */
final class DeploymentReview
{
    private const OPTION = 'smartcloud-wpsuite/deployment-review/';
    private static array $pendingByConnection = [];
    public static function url(): string { return admin_url('admin.php?page=smartcloud-wpsuite-deployment-review'); }
    public function boot(): void
    {
        add_action('admin_menu', [$this, 'menu'], PHP_INT_MAX);
        add_action('admin_notices', [$this, 'notice']);
        add_action('admin_post_wpsuite_deployment_review', [$this, 'submit']);
        add_filter('smartcloud_wpsuite_deployment_candidate_adapters', [$this, 'platformAdapter']);
    }
    public function menu(): void
    {
        add_submenu_page(null, __('Review deployment settings', 'smartcloud-wpsuite'), __('Review deployment settings', 'smartcloud-wpsuite'), 'manage_options', 'smartcloud-wpsuite-deployment-review', [$this, 'render']);
    }
    public function connected(): bool
    {
        if (!current_user_can('manage_options')) return false;
        try { $this->connection(); return true; } catch (\Throwable $e) { return false; }
    }
    private function connection(): array
    {
        $context = BackendProfiles::captureContext();
        if ($context !== null && (BackendProfiles::status()['active'] ?? null) !== $context['id']) throw new \RuntimeException('The selected profile changed. Reload the page.');
        $raw = get_option('smartcloud-wpsuite/site-settings', null);
        if ($raw === null) $raw = get_option('hub-for-wpsuiteio/site-settings', []);
        $settings = BackendProfiles::settings() ?? SiteSettings::fromArray(is_object($raw) ? get_object_vars($raw) : (is_array($raw) ? $raw : []));
        if ($settings->workspaceApiMode !== 'workspace' || !$settings->workspaceId || !$settings->siteId || !SiteSettings::usableSiteKey($settings->siteKey) || !$settings->platformApiBaseUrl || wp_parse_url($settings->platformApiBaseUrl, PHP_URL_SCHEME) !== 'https' || wp_parse_url($settings->platformApiBaseUrl, PHP_URL_USER) || wp_parse_url($settings->platformApiBaseUrl, PHP_URL_PASS) || wp_parse_url($settings->platformApiBaseUrl, PHP_URL_QUERY) || wp_parse_url($settings->platformApiBaseUrl, PHP_URL_FRAGMENT)) throw new \RuntimeException('Connect this site to a workspace first.');
        return [$settings, (string) ($context['id'] ?? 'legacy')];
    }
    private function read(int $timeout = 10, ?array $connection = null): array
    {
        [$s, $profile] = $connection ?? $this->connection();
        $url = sprintf('%s/workspace/%s/site/%s/settings?view=deployment-candidates', $s->platformApiBaseUrl, rawurlencode($s->workspaceId), rawurlencode($s->siteId));
        $response = wp_safe_remote_get($url, ['headers' => ['Accept' => 'application/json', 'X-Site-Key' => $s->siteKey], 'timeout' => $timeout, 'redirection' => 0, 'cookies' => [], 'limit_response_size' => 262144]);
        if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) throw new \RuntimeException('Deployment recommendations are unavailable. Please retry.');
        $data = json_decode(wp_remote_retrieve_body($response), true);
        $batch = $data['deploymentCandidates'] ?? null;
        if (!is_array($data) || ($data['site']['workspaceId'] ?? null) !== $s->workspaceId || ($data['site']['siteId'] ?? null) !== $s->siteId || !is_array($batch) || ($batch['schemaVersion'] ?? null) !== 1 || !is_int($batch['revision'] ?? null) || !is_array($batch['candidates'] ?? null)) throw new \RuntimeException('Invalid deployment recommendations response.');
        return [$s, $profile, $batch];
    }
    private function identity(SiteSettings $s, string $profile): string { return hash('sha256', wp_json_encode([$profile, $s->workspaceId, $s->siteId])); }
    private function sections(array $batch): array
    {
        $adapters = apply_filters('smartcloud_wpsuite_deployment_candidate_adapters', []);
        $result = [];
        foreach ($batch['candidates'] as $provider => $candidate) {
            if (!is_string($provider) || !is_array($candidate) || ($candidate['schemaVersion'] ?? null) !== 1 || !is_array($candidate['fields'] ?? null) || !isset($adapters[$provider]['sections']) || !is_callable($adapters[$provider]['sections'])) continue;
            $sections = call_user_func($adapters[$provider]['sections'], $candidate['fields']);
            if (is_array($sections)) foreach ($sections as $key => $section) if (is_string($key) && is_array($section) && !empty($section['rows']) && is_array($section['rows'])) $result[$provider . ':' . $key] = $section;
        }
        return $result;
    }
    private function fingerprint(array $sections): string { return hash('sha256', wp_json_encode($sections)); }
    private function reviewed(string $id, int $revision): bool
    {
        $record = get_option(self::OPTION . $id . '/' . $revision, []);
        return is_array($record) && ($record['reviewedRevision'] ?? null) === $revision;
    }
    public function hasPending(): bool
    {
        if (!current_user_can('manage_options')) return false;
        try {
            [$settings, $profile] = $this->connection();
        } catch (\Throwable $e) {
            return false;
        }
        $identity = $this->identity($settings, $profile);
        $key = get_current_blog_id() . '/' . $identity . '/' . $settings->connectionFingerprint();
        if (!array_key_exists($key, self::$pendingByConnection)) {
            try {
                [, , $batch] = $this->read(3, [$settings, $profile]);
                self::$pendingByConnection[$key] = $batch['revision'] > 0
                    && !$this->reviewed($identity, $batch['revision'])
                    && $this->sections($batch) !== [];
            } catch (\Throwable $e) {
                self::$pendingByConnection[$key] = false;
            }
        }
        return self::$pendingByConnection[$key];
    }
    public function notice(): void
    {
        if (!current_user_can('manage_options')) return;
        $page = isset($_GET['page']) && is_string($_GET['page']) ? sanitize_key(wp_unslash($_GET['page'])) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only admin page selector; no state change.
        if (in_array($page, ['smartcloud-wpsuite', 'smartcloud-wpsuite-deployment-review'], true) || (strpos($page, 'smartcloud') !== 0 && strpos($page, 'wpsuite') !== 0 && strpos($page, 'gatey') !== 0)) return;
        if (!$this->hasPending()) return;
        echo '<div class="notice notice-info"><p>' . esc_html__('Deployment recommendations are available for this site.', 'smartcloud-wpsuite') . ' <a href="' . esc_url(self::url()) . '">' . esc_html__('Review recommendations', 'smartcloud-wpsuite') . '</a></p></div>';
    }
    private function display(mixed $value): string
    {
        if (is_bool($value)) return $value ? __('Yes', 'smartcloud-wpsuite') : __('No', 'smartcloud-wpsuite');
        if ($value === null || $value === '') return '—';
        return is_scalar($value) ? (string) $value : (string) wp_json_encode($value);
    }
    public function render(): void
    {
        if (!current_user_can('manage_options')) wp_die(esc_html__('Forbidden', 'smartcloud-wpsuite'));
        echo '<div class="wrap"><h1>' . esc_html__('Review deployment settings', 'smartcloud-wpsuite') . '</h1>';
        try { [$s, $profile, $batch] = $this->read(); $sections = $this->sections($batch); }
        catch (\Throwable $e) { echo '<p>' . esc_html__('Deployment recommendations are unavailable. Please retry.', 'smartcloud-wpsuite') . '</p></div>'; return; }
        $result = get_transient($this->resultKey());
        delete_transient($this->resultKey());
        if (is_array($result)) foreach ($result as $line) echo '<div class="notice notice-info"><p>' . esc_html($line) . '</p></div>';
        if (!empty($batch['updatedAt']) && is_string($batch['updatedAt'])) echo '<p>' . esc_html__('Last changed:', 'smartcloud-wpsuite') . ' ' . esc_html($batch['updatedAt']) . '</p>';
        $record = get_option(self::OPTION . $this->identity($s, $profile) . '/' . $batch['revision'], []);
        if (is_array($record) && !empty($record['reviewedAt'])) echo '<p>' . esc_html__('Reviewed:', 'smartcloud-wpsuite') . ' ' . esc_html((string) $record['reviewedAt']) . '</p>';
        $reviewed = is_array($record) && ($record['reviewedRevision'] ?? null) === $batch['revision'];
        $dismissed = $reviewed && ($record['outcome'] ?? null) === 'dismiss';
        if ($dismissed) echo '<p>' . esc_html__('You dismissed this revision. The next deployment with changed recommendations will appear here.', 'smartcloud-wpsuite') . '</p>';
        elseif ($reviewed) echo '<p>' . esc_html__('This revision was already reviewed. You can still inspect its recommendations.', 'smartcloud-wpsuite') . '</p>';
        if (!$sections) { echo '<p>' . esc_html__('No available changes for installed plugins.', 'smartcloud-wpsuite') . '</p></div>'; return; }
        if ($dismissed) {
            echo '<details><summary>' . esc_html__('Show dismissed recommendations', 'smartcloud-wpsuite') . '</summary>';
        } else {
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
            wp_nonce_field('wpsuite_deployment_review');
            echo '<input type="hidden" name="action" value="wpsuite_deployment_review"><input type="hidden" name="identity" value="' . esc_attr($this->identity($s, $profile)) . '"><input type="hidden" name="connection" value="' . esc_attr($s->connectionFingerprint()) . '"><input type="hidden" name="revision" value="' . esc_attr((string) $batch['revision']) . '"><input type="hidden" name="fingerprint" value="' . esc_attr($this->fingerprint($sections)) . '">';
        }
        $hasApplicable = false;
        foreach ($sections as $id => $section) {
            echo '<h2>' . esc_html((string) ($section['title'] ?? $id)) . '</h2>';
            $provider = explode(':', $id, 2)[0]; $source = $batch['candidates'][$provider] ?? [];
            if (!empty($source['deploymentId']) && is_string($source['deploymentId'])) echo '<p>' . esc_html__('Deployment:', 'smartcloud-wpsuite') . ' ' . esc_html($source['deploymentId']) . (!empty($source['capturedAt']) && is_string($source['capturedAt']) ? ' · ' . esc_html($source['capturedAt']) : '') . '</p>';
            if (!empty($section['blocked'])) echo '<p>' . esc_html((string) $section['blocked']) . '</p>';
            if (!empty($section['link']) && is_string($section['link']) && str_starts_with($section['link'], admin_url())) echo '<p><a href="' . esc_url($section['link']) . '">' . esc_html__('Open settings', 'smartcloud-wpsuite') . '</a></p>';
            if (!$dismissed && empty($section['blocked'])) {
                $hasApplicable = true;
                echo '<label><input type="checkbox" name="sections[]" value="' . esc_attr($id) . '"' . (($section['defaultSelected'] ?? true) === false ? '' : ' checked') . '> ' . esc_html__('Apply this section', 'smartcloud-wpsuite') . '</label>';
            }
            echo '<table class="widefat striped"><thead><tr><th>' . esc_html__('Setting', 'smartcloud-wpsuite') . '</th><th>' . esc_html__('Current', 'smartcloud-wpsuite') . '</th><th>' . esc_html__('Recommended', 'smartcloud-wpsuite') . '</th></tr></thead><tbody>';
            foreach ($section['rows'] as $row) if (is_array($row)) echo '<tr><td>' . esc_html((string) ($row['label'] ?? $row['key'] ?? '')) . '</td><td>' . esc_html($this->display($row['current'] ?? null)) . '</td><td>' . esc_html($this->display($row['proposed'] ?? null)) . '</td></tr>';
            echo '</tbody></table>';
        }
        if ($dismissed) {
            echo '</details></div>';
        } else {
            echo '<p>';
            if ($hasApplicable) echo '<button class="button button-primary" name="decision" value="apply">' . esc_html__('Apply selected sections', 'smartcloud-wpsuite') . '</button> ';
            echo '<button class="button" name="decision" value="dismiss">' . esc_html__('Dismiss this revision', 'smartcloud-wpsuite') . '</button></p></form></div>';
        }
    }
    private function resultKey(): string { return 'wpsuite_deployment_result_' . get_current_blog_id() . '_' . get_current_user_id(); }
    public function submit(): void
    {
        if (!current_user_can('manage_options')) wp_die(esc_html__('Forbidden', 'smartcloud-wpsuite'));
        check_admin_referer('wpsuite_deployment_review');
        $message = 'The recommendations changed. Review them again.'; $messages = []; $successes = [];
        try {
            [$s, $profile, $batch] = $this->read(); $sections = $this->sections($batch); $identity = $this->identity($s, $profile);
            $posted = static fn($key) => isset($_POST[$key]) && is_string($_POST[$key]) ? sanitize_text_field(wp_unslash($_POST[$key])) : '';
            if (!hash_equals($identity, $posted('identity')) || !hash_equals($s->connectionFingerprint(), $posted('connection')) || (string) $batch['revision'] !== $posted('revision') || !hash_equals($this->fingerprint($sections), $posted('fingerprint'))) throw new \RuntimeException($message);
            $decision = $posted('decision');
            if ($decision === 'apply') {
                $record = get_option(self::OPTION . $identity . '/' . $batch['revision'], []);
                if (is_array($record) && ($record['reviewedRevision'] ?? null) === $batch['revision'] && ($record['outcome'] ?? null) === 'dismiss') throw new \RuntimeException('This revision was dismissed.');
                $requested = isset($_POST['sections']) && is_array($_POST['sections']) ? array_unique(array_filter(map_deep(wp_unslash($_POST['sections']), 'sanitize_text_field'), 'is_string')) : [];
                $applicable = array_filter($sections, static fn(array $section): bool => empty($section['blocked']));
                if (!$requested || array_diff($requested, array_keys($applicable))) throw new \RuntimeException('Select available sections before saving.');
                $selected = array_intersect(array_keys($applicable), $requested);
                $adapters = apply_filters('smartcloud_wpsuite_deployment_candidate_adapters', []); $errors = [];
                foreach ($selected as $id) {
                    $label = (string) ($sections[$id]['title'] ?? $id);
                    [$provider, $section] = array_pad(explode(':', $id, 2), 2, '');
                    // Re-read before each native save, including the preview of all remaining sections.
                    try { [$now, $nowProfile, $fresh] = $this->read(); $freshSections = $this->sections($fresh); }
                    catch (\Throwable $e) { $errors[] = $label; break; }
                    if ($this->identity($now, $nowProfile) !== $identity || !hash_equals($s->connectionFingerprint(), $now->connectionFingerprint()) || $fresh['revision'] !== $batch['revision'] || !isset($freshSections[$id]) || wp_json_encode($freshSections[$id]) !== wp_json_encode($sections[$id])) { $errors[] = $label; break; }
                    $callback = $adapters[$provider]['apply'] ?? null;
                    if (!is_callable($callback)) { $errors[] = $label; continue; }
                    try { $result = call_user_func($callback, $section, $fresh['candidates'][$provider]['fields'], $freshSections[$id]['rows']); }
                    catch (\Throwable $e) { $result = false; }
                    if ($result !== true) $errors[] = $label; else $successes[] = $label;
                }
                /* translators: %s: sections saved in WordPress. */
                if ($successes) $messages[] = sprintf(__('Saved in WordPress (%s).', 'smartcloud-wpsuite'), implode(', ', array_map(static fn(string $label): string => sanitize_text_field($label), $successes)));
                if ($errors) {
                    /* translators: %s: sections that need to be reviewed again. */
                    $messages[] = sprintf(__('Review and retry these sections (%s).', 'smartcloud-wpsuite'), implode(', ', array_map(static fn(string $label): string => sanitize_text_field($label), $errors)));
                    throw new \RuntimeException('Some sections were not applied.');
                }
                $message = __('Selected sections applied. This revision has been reviewed.', 'smartcloud-wpsuite');
            } elseif ($decision === 'dismiss') $message = __('This revision has been dismissed.', 'smartcloud-wpsuite');
            else throw new \RuntimeException('Invalid decision.');
            [$final, $finalProfile, $finalBatch] = $this->read();
            if ($this->identity($final, $finalProfile) !== $identity || !hash_equals($s->connectionFingerprint(), $final->connectionFingerprint()) || $finalBatch['revision'] !== $batch['revision']) throw new \RuntimeException('The connection or recommendations changed; review them again.');
            $record = ['reviewedRevision' => $batch['revision'], 'reviewedAt' => gmdate('c'), 'outcome' => $decision, 'admin' => get_current_user_id()];
            $option = self::OPTION . $identity . '/' . $batch['revision'];
            if (!update_option($option, $record, false) && get_option($option, false) !== $record) throw new \RuntimeException('Unable to record the review. Please retry.');
        } catch (\Throwable $e) { $message = __('The review could not be completed. Refresh and try again.', 'smartcloud-wpsuite'); }
        $messages[] = $message;
        set_transient($this->resultKey(), $messages, 5 * MINUTE_IN_SECONDS);
        wp_safe_redirect(self::url()); exit;
    }
    public function platformAdapter(array $adapters): array
    {
        $adapters['platform'] = ['sections' => [$this, 'platformSections'], 'apply' => [$this, 'platformApply']]; return $adapters;
    }
    private function platformValues(array $fields): array
    {
        return array_intersect_key($fields, array_flip(['reCaptchaPublicKey', 'useRecaptchaEnterprise']));
    }
    public function platformSections(array $fields): array
    {
        [$s] = $this->connection(); $rows = [];
        if (($fields['conflict'] ?? false) === true) {
            return ['recaptcha' => [
                'title' => __('Platform reCAPTCHA', 'smartcloud-wpsuite'),
                'blocked' => __('The linked deployments use different reCAPTCHA keys or modes. Verify the deployment settings before choosing a shared WordPress configuration.', 'smartcloud-wpsuite'),
                'rows' => [[
                    'key' => 'recaptchaConflict',
                    'label' => __('Deployment reCAPTCHA settings', 'smartcloud-wpsuite'),
                    'current' => $s->useRecaptchaEnterprise ? __('Enterprise', 'smartcloud-wpsuite') : __('Classic', 'smartcloud-wpsuite'),
                    'proposed' => __('Conflicting settings', 'smartcloud-wpsuite'),
                ]],
            ]];
        }
        $values = $this->platformValues($fields);
        if (!isset($values['reCaptchaPublicKey'], $values['useRecaptchaEnterprise']) || !is_string($values['reCaptchaPublicKey']) || !is_bool($values['useRecaptchaEnterprise'])) return [];
        foreach ($values as $key => $value) {
            if (($key === 'reCaptchaPublicKey' && !is_string($value)) || ($key === 'useRecaptchaEnterprise' && !is_bool($value))) continue;
            if ($s->$key !== $value) $rows[] = ['key' => $key, 'label' => $key === 'reCaptchaPublicKey' ? 'reCAPTCHA public key' : 'Use reCAPTCHA Enterprise', 'current' => $s->$key, 'proposed' => $value];
        }
        return $rows ? ['recaptcha' => ['title' => 'Platform: reCAPTCHA', 'rows' => $rows]] : [];
    }
    public function platformApply(string $section, array $fields): bool|\WP_Error
    {
        if ($section !== 'recaptcha' || ($fields['conflict'] ?? false) === true) return new \WP_Error('invalid_section', __('The reCAPTCHA recommendation requires manual review.', 'smartcloud-wpsuite'));
        return apply_filters('smartcloud_wpsuite_apply_platform_deployment_candidate', new \WP_Error('unavailable', 'Platform settings are unavailable.'), $this->platformValues($fields));
    }
}
