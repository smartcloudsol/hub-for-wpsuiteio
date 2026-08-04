<?php
/**
 * Shared read-only WordPress Abilities API helpers for WPSuite product plugins.
 *
 * This file is copied into each product plugin's smartcloud-wpsuite directory
 * from the shared repository and loaded by that plugin's hub-loader.php.
 *
 * @package smartcloud-wpsuite
 */

namespace SmartCloud\WPSuite\Hub\Abilities;

use WP_Error;

if (!defined('ABSPATH')) {
    exit;
}

if (class_exists(Product_Provider_Base::class, false)) {
    return;
}

abstract class Product_Provider_Base
{
    protected string $provider_id;
    protected string $label;
    protected string $ability_namespace;
    protected string $category;
    protected string $contract_version;
    protected string $plugin_version;
    protected string $text_domain;

    /** @var string[] */
    protected array $block_namespaces;

    /** @var string[] */
    protected array $registered_abilities = array();

    /**
     * @param string[] $block_namespaces
     */
    public function __construct(
        string $provider_id,
        string $label,
        string $ability_namespace,
        string $category,
        string $contract_version,
        string $plugin_version,
        string $text_domain,
        array $block_namespaces
    ) {
        $this->provider_id = $provider_id;
        $this->label = $label;
        $this->ability_namespace = trailingslashit($ability_namespace);
        $this->category = $category;
        $this->contract_version = $contract_version;
        $this->plugin_version = $plugin_version;
        $this->text_domain = $text_domain;
        $this->block_namespaces = array_values($block_namespaces);
    }

    public function bootstrap(): void
    {
        add_action('wp_abilities_api_categories_init', array($this, 'register_category'));
        add_action('wp_abilities_api_init', array($this, 'register_abilities'));
        add_filter('smartcloud_composer_execution_providers', array($this, 'register_provider_manifest'));
        add_filter('smartcloud_composer_provider_profiles', array($this, 'register_provider_profiles'));
    }

    public function register_category(): void
    {
        if (!function_exists('wp_register_ability_category')) {
            return;
        }

        wp_register_ability_category(
            $this->category,
            array(
                'label' => $this->label,
                'description' => sprintf('%s read-only product component abilities.', $this->label),
            )
        );
    }

    public function register_abilities(): void
    {
        if (!function_exists('wp_register_ability')) {
            return;
        }

        $this->registered_abilities = array();

        $this->register_ability('get-runtime-capabilities', 'Return runtime readiness, block registration, and missing non-secret requirements.', $this->empty_input_schema(), 'get_runtime_capabilities', $this->open_output_schema());
        $this->register_ability('list-components', 'List semantic components this provider can materialize.', $this->empty_input_schema(), 'list_components', $this->open_output_schema());
        $this->register_ability('get-component-schema', 'Return one semantic input schema and source-derived block contract.', $this->component_input_schema(), 'get_component_schema', $this->open_output_schema());
        $this->register_ability('materialize-component', 'Convert a semantic component specification to canonical Gutenberg blocks without saving a post.', $this->materialize_input_schema(), 'materialize_component', $this->open_output_schema());
        $this->register_ability('validate-block-tree', 'Validate a candidate product block tree.', $this->validate_input_schema(), 'validate_block_tree', $this->open_output_schema());

        foreach ($this->extra_abilities() as $ability) {
            $this->register_ability(
                (string) $ability['suffix'],
                (string) $ability['description'],
                is_array($ability['input_schema'] ?? null) ? $ability['input_schema'] : $this->empty_input_schema(),
                (string) $ability['method'],
                is_array($ability['output_schema'] ?? null) ? $ability['output_schema'] : $this->open_output_schema()
            );
        }
    }

    public function register_provider_manifest(array $providers): array
    {
        if ($this->registered_abilities !== $this->ability_names()) {
            return $providers;
        }

        $providers[$this->provider_id] = array(
            'id' => $this->provider_id,
            'label' => $this->label,
            'contract_version' => $this->contract_version,
            'plugin_version' => $this->plugin_version,
            'ability_names' => $this->ability_names(),
            'mcp_ability_names' => $this->mcp_ability_names(),
            'block_namespaces' => $this->block_namespaces,
        );

        return $providers;
    }

    public function register_provider_profiles(array $profiles): array
    {
        if ($this->registered_abilities !== $this->ability_names()) {
            return $profiles;
        }

        foreach ($this->ability_names() as $ability_name) {
            $suffix = substr($ability_name, strlen($this->ability_namespace));
            $operation = str_starts_with($suffix, 'materialize-')
                ? 'materialize'
                : (str_starts_with($suffix, 'validate-') ? 'validate' : 'discover');
            $profiles[] = array(
                'schema_version' => '1.0.0-rc.1',
                'provider' => array(
                    'id' => $this->provider_id,
                    'name' => $this->label,
                    'version' => $this->plugin_version,
                ),
                'ability' => array(
                    'name' => $ability_name,
                    'label' => ucwords(str_replace('-', ' ', $suffix)),
                    'description' => sprintf('%s provider capability.', $this->label),
                ),
                'composer' => array(
                    'provider_contract' => $this->contract_version,
                    'component_roles' => array('provider-component'),
                    'operation' => $operation,
                    'runtime_required' => true,
                    'agent_draft_safe' => true,
                ),
            );
        }

        return $profiles;
    }

    /**
     * @return string[]
     */
    public function ability_names(): array
    {
        $suffixes = array(
            'get-runtime-capabilities',
            'list-components',
            'get-component-schema',
            'materialize-component',
            'validate-block-tree',
        );

        foreach ($this->extra_abilities() as $ability) {
            $suffixes[] = (string) $ability['suffix'];
        }

        return array_map(fn(string $suffix): string => $this->ability_namespace . $suffix, $suffixes);
    }

    /**
     * @return string[]
     */
    public function mcp_ability_names(): array
    {
        return $this->ability_names();
    }

    public function check_permission($input = null): bool|WP_Error
    {
        $allowed = current_user_can('manage_options') || current_user_can('smartcloud_agent_use');

        if (is_array($input) && isset($input['post_id']) && absint($input['post_id']) > 0) {
            $allowed = $allowed && current_user_can('read_post', absint($input['post_id']));
        }

        return (bool) apply_filters(
            'smartcloud_product_abilities_permission_allowed',
            $allowed,
            $this->provider_id,
            $input
        );
    }

    /**
     * @return array<int,array{suffix:string,description:string,method:string,input_schema?:array,output_schema?:array}>
     */
    protected function extra_abilities(): array
    {
        return array();
    }

    protected function register_ability(string $suffix, string $description, array $input_schema, string $method, array $output_schema): void
    {
        if (!method_exists($this, $method)) {
            return;
        }

        $name = $this->ability_namespace . $suffix;
        $ability = wp_register_ability(
            $name,
            array(
                'label' => ucwords(str_replace('-', ' ', $suffix)),
                'description' => $description,
                'category' => $this->category,
                'input_schema' => $input_schema,
                'output_schema' => $output_schema,
                'execute_callback' => array($this, $method),
                'permission_callback' => array($this, 'check_permission'),
                'meta' => $this->ability_meta(),
            )
        );

        if ($ability !== null) {
            $this->registered_abilities[] = $name;
        }
    }

    protected function ability_meta(): array
    {
        return array(
            'annotations' => array(
                'readonly' => true,
                'destructive' => false,
                'idempotent' => true,
            ),
            'show_in_rest' => false,
            'mcp' => array(
                'public' => false,
            ),
            'smartcloud_composer' => array(
                'schema_version' => '1.0.0-rc.1',
                'provider_id' => $this->provider_id,
                'provider_contract' => $this->contract_version,
                'agent_draft_safe' => true,
            ),
        );
    }

    protected function empty_input_schema(): array
    {
        return array(
            'type' => 'object',
            'properties' => array(),
            'additionalProperties' => false,
        );
    }

    protected function component_input_schema(): array
    {
        return array(
            'type' => 'object',
            'required' => array('component'),
            'properties' => array(
                'component' => array(
                    'type' => 'string',
                    'minLength' => 1,
                    'maxLength' => 80,
                ),
            ),
            'additionalProperties' => false,
        );
    }

    protected function materialize_input_schema(): array
    {
        return array(
            'type' => 'object',
            'required' => array('component', 'spec'),
            'properties' => array(
                'component' => array(
                    'type' => 'string',
                    'minLength' => 1,
                    'maxLength' => 80,
                ),
                'spec' => array(
                    'type' => 'object',
                    'additionalProperties' => true,
                ),
            ),
            'additionalProperties' => false,
        );
    }

    protected function validate_input_schema(): array
    {
        return array(
            'type' => 'object',
            'required' => array('blocks'),
            'properties' => array(
                'blocks' => array(
                    'type' => 'array',
                    'maxItems' => 500,
                    'items' => array(
                        'type' => 'object',
                        'additionalProperties' => true,
                    ),
                ),
            ),
            'additionalProperties' => false,
        );
    }

    protected function post_id_input_schema(): array
    {
        return array(
            'type' => 'object',
            'properties' => array(
                'post_id' => array(
                    'type' => 'integer',
                    'minimum' => 1,
                ),
            ),
            'additionalProperties' => false,
        );
    }

    protected function open_output_schema(): array
    {
        return array(
            'type' => 'object',
            'required' => array('provider', 'contract_version'),
            'properties' => array(
                'provider' => array('type' => 'string'),
                'contract_version' => array('type' => 'string'),
            ),
            'additionalProperties' => true,
        );
    }

    protected function block_metadata(string $plugin_path, string $block_slug): array
    {
        foreach (array('blocks/src/', 'blocks/') as $base) {
            $path = trailingslashit($plugin_path) . $base . $block_slug . '/block.json';
            if (!is_readable($path)) {
                continue;
            }
            $decoded = json_decode((string) file_get_contents($path), true);
            return is_array($decoded) ? $decoded : array();
        }

        return array();
    }

    protected function block_attributes(string $plugin_path, string $block_name): array
    {
        $parts = explode('/', $block_name, 2);
        $metadata = $this->block_metadata($plugin_path, $parts[1] ?? '');

        return is_array($metadata['attributes'] ?? null) ? $metadata['attributes'] : array();
    }

    protected function block_defaults(string $plugin_path, string $block_name): array
    {
        $defaults = array();
        foreach ($this->block_attributes($plugin_path, $block_name) as $attribute => $schema) {
            if (is_array($schema) && array_key_exists('default', $schema)) {
                $defaults[$attribute] = $schema['default'];
            }
        }

        return $defaults;
    }

    protected function filter_attrs(string $plugin_path, string $block_name, array $attrs): array
    {
        return array_intersect_key($attrs, $this->block_attributes($plugin_path, $block_name));
    }

    protected function block_registered(string $block_name): bool
    {
        return class_exists('\WP_Block_Type_Registry')
            && \WP_Block_Type_Registry::get_instance()->is_registered($block_name);
    }

    /**
     * @param string[] $block_names
     */
    protected function block_registration_status(array $block_names): array
    {
        $status = array();
        foreach ($block_names as $block_name) {
            $status[$block_name] = $this->block_registered($block_name);
        }

        return $status;
    }

    protected function block(string $name, array $attrs = array(), array $inner_blocks = array(), ?string $inner_html = null, ?array $inner_content = null): array
    {
        if ($inner_html === null || $inner_content === null) {
            $class = 'wp-block-' . str_replace('/', '-', $name);
            if (empty($inner_blocks)) {
                $inner_html = '<div class="' . esc_attr($class) . '"></div>';
                $inner_content = array($inner_html);
            } else {
                $inner_html = '<div class="' . esc_attr($class) . '">' . $this->serialize_blocks($inner_blocks) . '</div>';
                $inner_content = array('<div class="' . esc_attr($class) . '">');
                foreach ($inner_blocks as $_block) {
                    $inner_content[] = null;
                }
                $inner_content[] = '</div>';
            }
        }

        return array(
            'blockName' => $name,
            'attrs' => $attrs,
            'innerBlocks' => $inner_blocks,
            'innerHTML' => $inner_html,
            'innerContent' => $inner_content,
        );
    }

    protected function transparent_block(string $name, array $attrs = array(), array $inner_blocks = array()): array
    {
        return array(
            'blockName' => $name,
            'attrs' => $attrs,
            'innerBlocks' => $inner_blocks,
            'innerHTML' => '',
            'innerContent' => array_fill(0, count($inner_blocks), null),
        );
    }

    protected function serialize_blocks(array $blocks): string
    {
        if (function_exists('serialize_blocks')) {
            return serialize_blocks($blocks);
        }

        return implode('', array_map(static fn(array $block): string => function_exists('serialize_block') ? serialize_block($block) : '', $blocks));
    }

    protected function flatten_block_names(array $blocks): array
    {
        $names = array();
        foreach ($blocks as $block) {
            if (!is_array($block)) {
                continue;
            }
            if (!empty($block['blockName'])) {
                $names[] = (string) $block['blockName'];
            }
            $names = array_merge($names, $this->flatten_block_names(is_array($block['innerBlocks'] ?? null) ? $block['innerBlocks'] : array()));
        }

        return array_values(array_unique($names));
    }

    protected function count_blocks(array $blocks): int
    {
        $count = 0;
        foreach ($blocks as $block) {
            if (!is_array($block)) {
                continue;
            }
            $count++;
            $count += $this->count_blocks(is_array($block['innerBlocks'] ?? null) ? $block['innerBlocks'] : array());
        }

        return $count;
    }

    protected function validation_issue(string $code, string $message, string $path): array
    {
        return array(
            'code' => $code,
            'message' => $message,
            'path' => $path,
        );
    }

    protected function materialization_result(string $component, array $blocks, bool $runtime_ready, array $missing_requirements = array(), array $warnings = array()): array
    {
        return array(
            'provider' => $this->provider_id,
            'provider_version' => $this->plugin_version,
            'contract_version' => $this->contract_version,
            'component' => $component,
            'valid' => true,
            'blocks' => $blocks,
            'serialized_content' => $this->serialize_blocks($blocks),
            'block_names' => $this->flatten_block_names($blocks),
            'runtime_ready' => $runtime_ready,
            'missing_requirements' => array_values($missing_requirements),
            'warnings' => array_values($warnings),
        );
    }

    protected function validation_result(array $blocks, array $errors, array $warnings = array()): array
    {
        return array(
            'provider' => $this->provider_id,
            'contract_version' => $this->contract_version,
            'valid' => empty($errors),
            'errors' => array_values($errors),
            'warnings' => array_values($warnings),
            'blocks' => empty($errors) ? $blocks : array(),
            'serialized_content' => empty($errors) ? $this->serialize_blocks($blocks) : '',
            'statistics' => array(
                'block_count' => $this->count_blocks($blocks),
                'block_names' => $this->flatten_block_names($blocks),
            ),
        );
    }

    abstract public function get_runtime_capabilities(array $input = array()): array|WP_Error;

    abstract public function list_components(array $input = array()): array|WP_Error;

    abstract public function get_component_schema(array $input): array|WP_Error;

    abstract public function materialize_component(array $input): array|WP_Error;

    abstract public function validate_block_tree(array $input): array|WP_Error;
}
