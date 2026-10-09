<?php

namespace SmartCloud\WPSuite\Hub;

if (!defined('ABSPATH')) {
    exit;
}

/** Transport for optional plugin-owned surfaces. No product configuration lives here. */
final class CapabilitySurfaces
{
    public function registerRoutes(): void
    {
        $route = '/admin-surfaces/(?P<id>[a-z][a-z0-9-]{0,63})';
        register_rest_route('smartcloud-wpsuite/v1', $route, array(
            array('methods' => 'GET', 'callback' => array($this, 'read'), 'permission_callback' => array($this, 'permission')),
            array('methods' => 'PATCH', 'callback' => array($this, 'save'), 'permission_callback' => array($this, 'permission')),
        ));
        register_rest_route('smartcloud-wpsuite/v1', $route . '/action', array(
            'methods' => 'POST', 'callback' => array($this, 'action'), 'permission_callback' => array($this, 'permission'),
        ));
    }

    public function permission(\WP_REST_Request $request): bool|\WP_Error
    {
        $provider = $this->provider((string) $request['id']);
        return is_wp_error($provider) ? $provider : true;
    }

    private function provider(string $id): array|\WP_Error
    {
        $descriptors = apply_filters('smartcloud_wpsuite_admin_capabilities', array());
        $found = null;
        foreach (is_array($descriptors) ? $descriptors : array() as $entry) {
            if (!is_array($entry) || ($entry['schema_version'] ?? null) !== 1 || ($entry['id'] ?? '') !== $id) {
                continue;
            }
            if ($found !== null && $entry !== $found) {
                return new \WP_Error('surface_conflict', __('This tool has conflicting registrations.', 'smartcloud-wpsuite'), array('status' => 409));
            }
            $found = $entry;
        }
        if ($found === null || !is_callable($found['surface_provider'] ?? null)) {
            return new \WP_Error('surface_unavailable', __('This plugin does not provide a simplified surface.', 'smartcloud-wpsuite'), array('status' => 404));
        }
        $cap = $found['surface_capability'] ?? $found['required_capability'] ?? '';
        if (!is_string($cap) || $cap === '' || !current_user_can($cap)) {
            return new \WP_Error('surface_forbidden', __('You do not have permission to use this tool.', 'smartcloud-wpsuite'), array('status' => 403));
        }
        return $found;
    }

    private function invoke(callable $callback, array $arguments = array()): mixed
    {
        try {
            return $callback(...$arguments);
        } catch (\Throwable $error) {
            // A provider failure cannot expose configuration or crash the rest of WP Admin.
            return new \WP_Error('surface_failed', __('The plugin could not complete this request. Its Advanced settings remain available.', 'smartcloud-wpsuite'), array('status' => 500));
        }
    }

    public function read(\WP_REST_Request $request): array|\WP_Error
    {
        $provider = $this->provider((string) $request['id']);
        return is_wp_error($provider) ? $provider : $this->project($this->invoke($provider['surface_provider']));
    }

    public function save(\WP_REST_Request $request): array|\WP_Error
    {
        $provider = $this->provider((string) $request['id']);
        if (is_wp_error($provider)) {
            return $provider;
        }
        $surface = $this->project($this->invoke($provider['surface_provider']));
        if (is_wp_error($surface)) {
            return $surface;
        }
        if (!$surface['can_edit'] || !is_callable($provider['surface_save'] ?? null)) {
            return new \WP_Error('surface_read_only', __('These settings are read-only.', 'smartcloud-wpsuite'), array('status' => 403));
        }
        $body = $request->get_json_params();
        if (!is_array($body) || array_diff(array_keys($body), array('values', 'revision'))
            || !is_array($body['values'] ?? null) || !is_string($body['revision'] ?? null) || $body['revision'] === '') {
            return $this->invalidInput();
        }
        $fields = array_merge(...array_merge(array(array()), array_column($surface['steps'], 'fields')));
        if (!$this->validInput($body['values'], $fields)) {
            return $this->invalidInput();
        }
        // Each plugin rechecks the revision against fresh canonical state immediately
        // before its allowlisted merge. No shared option or Pro write occurs here.
        return $this->project($this->invoke($provider['surface_save'], array($body['values'], $body['revision'])));
    }

    public function action(\WP_REST_Request $request): array|\WP_Error
    {
        $provider = $this->provider((string) $request['id']);
        if (is_wp_error($provider)) {
            return $provider;
        }
        $body = $request->get_json_params();
        if (!is_array($body) || array_diff(array_keys($body), array('action', 'input'))
            || !is_string($body['action'] ?? null) || !is_array($body['input'] ?? array())) {
            return $this->invalidInput();
        }
        $surface = $this->project($this->invoke($provider['surface_provider']));
        if (is_wp_error($surface)) {
            return $surface;
        }
        $actions = array_column($surface['actions'], null, 'id');
        $action = $actions[$body['action']] ?? null;
        if ($action === null || !is_callable($provider['surface_action'] ?? null)) {
            return new \WP_Error('surface_action_unavailable', __('This action is not available.', 'smartcloud-wpsuite'), array('status' => 403));
        }
        if (!$this->validInput($body['input'] ?? array(), $action['fields'])) {
            return $this->invalidInput();
        }
        $result = $this->invoke($provider['surface_action'], array($body['action'], $body['input'] ?? array()));
        if (is_wp_error($result)) {
            return $result;
        }
        if (!is_array($result) || !is_string($result['message'] ?? null)) {
            return $this->invalidSurface();
        }
        $public = array('message' => $result['message']);
        if (isset($result['severity']) && in_array($result['severity'], array('success', 'warning', 'error'), true)) {
            $public['severity'] = $result['severity'];
        }
        if (isset($result['redirect']) && $this->safeLink($result['redirect'])) {
            $public['redirect'] = $result['redirect'];
        }
        return $public;
    }

    private function validInput(array $values, array $fields): bool
    {
        $known = array_column($fields, null, 'id');
        foreach ($values as $key => $value) {
            if (!isset($known[$key]) || !(is_string($value) || is_bool($value) || is_int($value) || is_float($value))) {
                return false;
            }
            $field = $known[$key];
            if (($field['type'] === 'checkbox' && !is_bool($value))
                || ($field['type'] === 'number' && !is_int($value) && !is_float($value))
                || (!in_array($field['type'], array('checkbox', 'number'), true) && !is_string($value))
                || (is_string($value) && strlen($value) > 8192)
                || ($field['type'] === 'select' && !in_array($value, array_column($field['options'], 'value'), true))) {
                return false;
            }
        }
        return true;
    }

    private function invalidInput(): \WP_Error
    {
        return new \WP_Error('surface_invalid_input', __('Only the displayed fields and actions may be changed.', 'smartcloud-wpsuite'), array('status' => 400));
    }

    private function invalidSurface(): \WP_Error
    {
        return new \WP_Error('surface_invalid', __('The plugin returned an unsupported simplified surface.', 'smartcloud-wpsuite'), array('status' => 500));
    }

    /** Project a strictly bounded public contract, excluding unlisted provider data. */
    private function project(mixed $value): array|\WP_Error
    {
        if (is_wp_error($value)) {
            return $value;
        }
        if (!is_array($value) || ($value['schema_version'] ?? null) !== 1
            || !is_bool($value['configured'] ?? null) || !is_bool($value['can_edit'] ?? null)
            || (array_key_exists('can_setup', $value) && !is_bool($value['can_setup']))
            || !is_string($value['revision'] ?? null) || !is_array($value['status'] ?? null)
            || !in_array($value['status']['state'] ?? '', array('ready', 'needs_setup', 'unavailable'), true)
            || !is_string($value['status']['label'] ?? null)) {
            return $this->invalidSurface();
        }
        foreach (array('metrics', 'steps', 'actions', 'links', 'runtime_fields') as $key) {
            if (isset($value[$key]) && !is_array($value[$key])) {
                return $this->invalidSurface();
            }
        }
        $sourceValues = $value['values'] ?? array();
        if ($sourceValues instanceof \stdClass) {
            $sourceValues = get_object_vars($sourceValues);
        }
        if (!is_array($sourceValues)) {
            return $this->invalidSurface();
        }
        $result = array(
            'schema_version' => 1, 'configured' => $value['configured'], 'can_edit' => $value['can_edit'],
            'revision' => $value['revision'], 'status' => array('state' => $value['status']['state'], 'label' => $value['status']['label']),
            'notice' => is_string($value['notice'] ?? null) ? $value['notice'] : '',
            'metrics' => array(), 'steps' => array(), 'actions' => array(), 'links' => array(),
        );
        if (array_key_exists('can_setup', $value)) {
            $result['can_setup'] = $value['can_setup'];
        }
        foreach ($value['metrics'] ?? array() as $metric) {
            if (is_array($metric) && is_string($metric['label'] ?? null) && is_scalar($metric['value'] ?? null)) {
                $result['metrics'][] = array_merge(array('label' => $metric['label'], 'value' => $metric['value']), $this->helpReference($metric));
            }
        }
        $visibleValues = array();
        foreach ($value['steps'] ?? array() as $step) {
            if (!is_array($step) || !is_string($step['id'] ?? null) || !is_string($step['title'] ?? null)) {
                return $this->invalidSurface();
            }
            $fields = $this->fields($step['fields'] ?? array());
            if (is_wp_error($fields)) {
                return $fields;
            }
            foreach ($fields as $field) {
                $fieldValue = $sourceValues[$field['id']] ?? ($field['type'] === 'checkbox' ? false : '');
                if (!is_scalar($fieldValue)) {
                    return $this->invalidSurface();
                }
                $visibleValues[$field['id']] = $fieldValue;
            }
            $result['steps'][] = array_merge(array('id' => $step['id'], 'title' => $step['title'], 'description' => is_string($step['description'] ?? null) ? $step['description'] : '', 'fields' => $fields), $this->helpReference($step));
        }
        $result['values'] = (object) $visibleValues;
        foreach ($value['actions'] ?? array() as $action) {
            if (!is_array($action) || !is_string($action['id'] ?? null) || !is_string($action['label'] ?? null)) {
                return $this->invalidSurface();
            }
            $fields = $this->fields($action['fields'] ?? array());
            if (is_wp_error($fields)) {
                return $fields;
            }
            $result['actions'][] = array('id' => $action['id'], 'label' => $action['label'], 'confirm' => is_string($action['confirm'] ?? null) ? $action['confirm'] : '', 'fields' => $fields);
        }
        foreach ($value['links'] ?? array() as $link) {
            if (is_array($link) && is_string($link['label'] ?? null) && $this->safeLink($link['url'] ?? null)) {
                $result['links'][] = array('label' => $link['label'], 'url' => $link['url']);
            }
        }
        if (isset($value['primary_link'])) {
            $link = $value['primary_link'];
            if (is_array($link) && is_string($link['label'] ?? null) && strlen($link['label']) <= 256 && $this->safeLink($link['url'] ?? null)) {
                $result['primary_link'] = array('label' => $link['label'], 'url' => $link['url']);
            }
        }
        if (is_string($value['runtime_plugin'] ?? null) && preg_match('/^[a-zA-Z][a-zA-Z0-9-]*$/D', $value['runtime_plugin'])) {
            $result['runtime_plugin'] = $value['runtime_plugin'];
            $result['runtime_fields'] = array();
            foreach ($value['runtime_fields'] ?? array() as $field) {
                if (is_array($field) && is_string($field['label'] ?? null) && is_string($field['path'] ?? null)
                    && preg_match('/^[a-zA-Z][a-zA-Z0-9_.]*$/D', $field['path'])
                    && in_array($field['format'] ?? 'text', array('text', 'boolean', 'count'), true)) {
                    $result['runtime_fields'][] = array('label' => $field['label'], 'path' => $field['path'], 'format' => $field['format'] ?? 'text');
                }
            }
        }
        if (array_key_exists('use_on_site', $value)) {
            $use = $value['use_on_site'];
            if (!is_array($use) || !is_string($use['description'] ?? null) || strlen($use['description']) > 4096
                || !is_array($use['items'] ?? null) || count($use['items']) > 12) {
                return $this->invalidSurface();
            }
            $items = array();
            foreach ($use['items'] as $item) {
                if (!is_array($item) || !is_string($item['id'] ?? null) || !preg_match('/^[a-z][a-z0-9-]{0,63}$/D', $item['id'])
                    || isset($items[$item['id']]) || !is_string($item['title'] ?? null) || strlen($item['title']) > 256
                    || !is_string($item['description'] ?? null) || strlen($item['description']) > 4096
                    || (isset($item['status']) && (!is_string($item['status']) || strlen($item['status']) > 1024))
                    || !is_array($item['links'] ?? null) || count($item['links']) > 8) {
                    return $this->invalidSurface();
                }
                $public = array_merge(array('id' => $item['id'], 'title' => $item['title'], 'description' => $item['description'], 'links' => array()), $this->helpReference($item));
                if (isset($item['status'])) { $public['status'] = $item['status']; }
                foreach ($item['links'] as $link) {
                    if (is_array($link) && is_string($link['label'] ?? null) && $this->safeLink($link['url'] ?? null)) {
                        $public['links'][] = array('label' => $link['label'], 'url' => $link['url']);
                    }
                }
                $items[$item['id']] = $public;
            }
            $result['use_on_site'] = array('description' => $use['description'], 'items' => array_values($items));
        }
        if (isset($value['introduction'])) {
            $intro = $value['introduction'];
            if (!is_array($intro) || !is_string($intro['title'] ?? null) || strlen($intro['title']) > 256
                || !is_string($intro['description'] ?? null) || strlen($intro['description']) > 4096
                || !is_array($intro['items'] ?? null) || count($intro['items']) > 8) { return $this->invalidSurface(); }
            $items = array();
            foreach ($intro['items'] as $item) {
                if (!is_array($item) || !is_string($item['title'] ?? null) || strlen($item['title']) > 256
                    || !is_string($item['description'] ?? null) || strlen($item['description']) > 4096) { return $this->invalidSurface(); }
                $items[] = array('title' => $item['title'], 'description' => $item['description']);
            }
            $result['introduction'] = array('title' => $intro['title'], 'description' => $intro['description'], 'items' => $items);
        }
        if (isset($value['help'])) {
            if (!is_array($value['help']) || count($value['help']) > 32) { return $this->invalidSurface(); }
            $topics = array();
            foreach ($value['help'] as $topic) {
                if (!is_array($topic) || !$this->helpReference(array('help_id' => $topic['id'] ?? null))
                    || isset($topics[$topic['id']]) || !is_string($topic['title'] ?? null) || strlen($topic['title']) > 256
                    || !is_string($topic['summary'] ?? null) || strlen($topic['summary']) > 1024
                    || !is_array($topic['paragraphs'] ?? null) || count($topic['paragraphs']) > 8) { return $this->invalidSurface(); }
                foreach ($topic['paragraphs'] as $paragraph) {
                    if (!is_string($paragraph) || strlen($paragraph) > 4096) { return $this->invalidSurface(); }
                }
                $topics[$topic['id']] = array('id' => $topic['id'], 'title' => $topic['title'], 'summary' => $topic['summary'], 'paragraphs' => array_values($topic['paragraphs']));
            }
            $result['help'] = array_values($topics);
        }
        return $result;
    }

    private function helpReference(array $value): array
    {
        return is_string($value['help_id'] ?? null) && preg_match('/^[a-z][a-z0-9-]{0,63}$/D', $value['help_id'])
            ? array('help_id' => $value['help_id']) : array();
    }

    private function fields(mixed $fields): array|\WP_Error
    {
        if (!is_array($fields)) {
            return $this->invalidSurface();
        }
        $public = array();
        foreach ($fields as $field) {
            if (!is_array($field) || !is_string($field['id'] ?? null) || !preg_match('/^[a-zA-Z][a-zA-Z0-9_.-]*$/D', $field['id'])
                || !is_string($field['label'] ?? null) || !in_array($field['type'] ?? '', array('text', 'url', 'number', 'checkbox', 'select'), true)
                || (isset($field['options']) && !is_array($field['options']))) {
                return $this->invalidSurface();
            }
            $entry = array('id' => $field['id'], 'label' => $field['label'], 'type' => $field['type'],
                'required' => ($field['required'] ?? false) === true, 'description' => is_string($field['description'] ?? null) ? $field['description'] : '', 'options' => array());
            $entry = array_merge($entry, $this->helpReference($field));
            if (isset($field['suggestions_url'])) {
                if ($field['type'] !== 'text' || !$this->safeLink($field['suggestions_url'])) {
                    return $this->invalidSurface();
                }
                $entry['suggestions_url'] = $field['suggestions_url'];
            }
            foreach ($field['options'] ?? array() as $option) {
                if (is_array($option) && is_string($option['label'] ?? null) && is_string($option['value'] ?? null)) {
                    $entry['options'][] = array('label' => $option['label'], 'value' => $option['value']);
                }
            }
            $public[] = $entry;
        }
        return $public;
    }

    private function safeLink(mixed $url): bool
    {
        if (!is_string($url) || preg_match('/[\x00-\x20\\\\]/', $url)) {
            return false;
        }
        $parts = wp_parse_url($url);
        $site = wp_parse_url(admin_url());
        return is_array($parts) && in_array($parts['scheme'] ?? '', array('http', 'https'), true)
            && !isset($parts['user']) && !isset($parts['pass'])
            && ($parts['host'] ?? '') === ($site['host'] ?? '') && ($parts['port'] ?? null) === ($site['port'] ?? null);
    }
}
