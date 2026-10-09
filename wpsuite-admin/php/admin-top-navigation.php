<?php

namespace SmartCloud\WPSuite\Hub;

if (!defined('ABSPATH')) {
    exit;
}

/** Shared navigation for both React surfaces and plugin-owned WordPress screens. */
final class AdminTopNavigation
{
    private bool $rendered = false;

    public function __construct(private AdminNavigation $navigation)
    {
        add_action('admin_enqueue_scripts', array($this, 'enqueue'));
        add_action('admin_notices', array($this, 'render'), -1000);
    }

    public function enqueue(): void
    {
        if ($this->navigation->topNavigationData() === null) {
            return;
        }
        foreach (array('css', 'js') as $type) {
            $relative = 'assets/' . $type . '/admin-top-navigation.' . $type;
            $version = substr(hash_file('sha256', __DIR__ . '/' . $relative), 0, 16);
            if ($type === 'css') {
                wp_enqueue_style('wpsuite-admin-top-navigation', SMARTCLOUD_WPSUITE_URL . $relative, array(), $version);
            } else {
                wp_enqueue_script('wpsuite-admin-top-navigation', SMARTCLOUD_WPSUITE_URL . $relative, array(), $version, true);
            }
        }
    }

    public function render(): void
    {
        $data = $this->navigation->topNavigationData();
        if ($this->rendered || $data === null) {
            return;
        }
        $this->rendered = true;
        echo '<nav class="wpsuite-top-navigation" aria-label="' . esc_attr(__('WP Suite navigation', 'smartcloud-wpsuite')) . '">';
        echo '<a class="wpsuite-top-navigation__link" href="' . esc_url($data['overview_url']) . '"' . ($data['active'] === 'overview' ? ' aria-current="page"' : '') . '>' . esc_html(__('Overview', 'smartcloud-wpsuite')) . '</a>';
        echo '<div class="wpsuite-top-navigation__advanced">';
        echo '<button class="wpsuite-top-navigation__toggle wpsuite-top-navigation__tools" type="button" aria-label="' . esc_attr(__('Tools on this site', 'smartcloud-wpsuite')) . '" aria-expanded="false" aria-controls="wpsuite-advanced-navigation">' . esc_html(__('Tools on this site', 'smartcloud-wpsuite')) . ' <svg class="wpsuite-top-navigation__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg></button>';
        echo '<div class="wpsuite-top-navigation__panel" id="wpsuite-advanced-navigation" hidden><div class="wpsuite-top-navigation__groups">';
        foreach ($data['groups'] as $group) {
            if (empty($group['url'])) { continue; }
            echo '<section class="wpsuite-top-navigation__group"><h2><a href="' . esc_url($group['url']) . '">' . esc_html($group['label']) . '</a></h2>';
            if (!empty($group['product']) && $group['product'] !== $group['label']) {
                echo '<p class="wpsuite-top-navigation__origin">' . esc_html(sprintf(__('Powered by %s', 'smartcloud-wpsuite'), $group['product'] === 'AI-Kit' ? 'SmartCloud AI-Kit' : $group['product'])) . '</p>';
            }
            echo '<ul>';
            foreach ($group['links'] as $link) {
                echo '<li><a href="' . esc_url($link['url']) . '">' . esc_html($link['label']) . '</a></li>';
            }
            echo '</ul></section>';
        }
        echo '</div></div></div>';
        if (!empty($data['can_manage_connection'])) {
            echo '<a class="wpsuite-top-navigation__link" href="' . esc_url($data['advanced_url']) . '"' . ($data['active'] === 'platform' ? ' aria-current="page"' : '') . '>' . esc_html(__('Platform Settings', 'smartcloud-wpsuite')) . '</a>';
        }
        echo '</nav>';
    }
}
