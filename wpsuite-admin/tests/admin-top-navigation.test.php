<?php

declare(strict_types=1);

// Reuse the registry fixture and its existing permission/URL validation contract.
ob_start();
require __DIR__ . '/navigation.test.php';
ob_end_clean();
function esc_attr(string $value): string { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); }
function esc_html(string $value): string { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); }
function esc_url(string $value): string { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); }
function wp_enqueue_style(...$args): void { $GLOBALS['enqueued'][] = array('style', $args); }
function wp_enqueue_script(...$args): void { $GLOBALS['enqueued'][] = array('script', $args); }
define('SMARTCLOUD_WPSUITE_URL', '/hub/');
$permissions = array('read', 'manage_options', 'edit_posts');
$menu = array(array('WP Suite', 'manage_options', 'smartcloud-wpsuite'));
$submenu = array();
$GLOBALS['plugin_page'] = '';
$_GET = array();
$gatey = descriptor();
$gatey['advanced_links'][] = array('label' => 'Patterns', 'url' => admin_url('edit.php?post_type=wp_block&s=gatey'), 'required_capability' => 'edit_posts');
$gatey['advanced_links'][] = array('label' => 'API settings', 'url' => admin_url('admin.php?page=gatey&section=api-settings'));
$ai = descriptor('answers');
$ai['label'] = 'Answers';
$ai['product_id'] = 'smartcloud-ai-kit'; $ai['product'] = 'SmartCloud AI Kit';
$ai['advanced_links'] = array(array('label' => 'Knowledge base', 'url' => admin_url('admin.php?page=ai-kit&section=kb-admin')));
$aiTools = $ai; $aiTools['id'] = 'ai-tools';
$composer = descriptor('ai-editing'); $composer['label'] = 'AI Editing'; $composer['product_id'] = 'smartcloud-agent-composer'; $composer['product'] = 'SmartCloud Agent Composer';
$composer['advanced_links'] = array(array('label' => 'Configuration', 'url' => admin_url('admin.php?page=smartcloud-agent-composer&section=configuration')));
foreach (array('gatey', 'ai-kit', 'smartcloud-agent-composer') as $page) $_registered_pages[get_plugin_page_hookname($page, 'smartcloud-wpsuite')] = true;
$descriptors = array($gatey, $ai, $aiTools, $composer);
$navigation = new \SmartCloud\WPSuite\Hub\AdminNavigation(new \SmartCloud\WPSuite\Hub\HubAdmin());
$navigation->registerMenus();
$GLOBALS['pagenow'] = 'admin.php';
foreach (array('smartcloud-wpsuite', 'smartcloud-wpsuite-advanced', 'smartcloud-wpsuite-capability-answers', 'gatey', 'smartcloud-wpsuite-settings') as $page) {
    $GLOBALS['plugin_page'] = $page;
    check($navigation->topNavigationData() !== null, 'Known surface/detail screen must have common navigation: ' . $page);
}
$GLOBALS['plugin_page'] = 'untouched-old-plugin';
check($navigation->topNavigationData() === null, 'Unknown old-generation screens stay untouched.');
$GLOBALS['plugin_page'] = 'gatey'; $GLOBALS['pagenow'] = 'users.php';
check($navigation->topNavigationData() === null, 'A page query cannot attach navigation to an unrelated admin script.');
$GLOBALS['plugin_page'] = '';
$GLOBALS['pagenow'] = 'edit.php';
$_GET = array('post_type' => 'wp_block', 's' => 'gatey');
check($navigation->topNavigationData()['active'] === '', 'Registered Patterns screen gets Advanced navigation.');
$_GET = array('post_type' => 'wp_block');
check($navigation->topNavigationData() === null, 'Unrelated Patterns lists stay untouched.');
$GLOBALS['plugin_page'] = 'gatey';
$GLOBALS['pagenow'] = 'admin.php';
$_GET = array('page' => 'gatey', 'section' => 'api-settings');
$data = $navigation->topNavigationData();
check($data['active'] === '', 'Detailed subsection highlights Advanced.');
check(array_column($data['groups'], 'label') === array('AI Editing', 'Answers', 'Login & Access', 'Platform'), 'Groups lead with product menu labels in registry order.');
$urls = array();
foreach ($data['groups'] as $group) foreach ($group['links'] as $link) $urls[] = $link['url'];
check(count($urls) === count(array_unique($urls)), 'Shared AI Kit links appear once.');
check(!str_contains(json_encode($data), 'nonce') && !str_contains(json_encode($data), 'siteKey') && !str_contains(json_encode($data), 'install-plugin'), 'Top navigation exposes no configuration, nonce or installer actions.');
$top = new \SmartCloud\WPSuite\Hub\AdminTopNavigation($navigation);
$GLOBALS['enqueued'] = array();
$top->enqueue();
check(count($GLOBALS['enqueued']) === 2, 'Known screen enqueues standalone CSS and JS.');
ob_start(); $top->render(); $top->render(); $html = ob_get_clean();
check(substr_count($html, '<nav ') === 1, 'Navigation renders once even if notices repeat.');
check(str_contains($html, 'aria-expanded="false"') && str_contains($html, 'id="wpsuite-advanced-navigation" hidden'), 'Disclosure starts closed and has an accessible control relationship.');
check(str_contains($html, 'section=api-settings'), 'Deep links preserve exact registered subsection.');
if (in_array('--render', $argv, true)) { echo $html; exit; }
$permissions = array('read', 'edit_posts');
$GLOBALS['plugin_page'] = '';
$GLOBALS['pagenow'] = 'edit.php';
$_GET = array('post_type' => 'wp_block', 's' => 'gatey');
$restricted = new \SmartCloud\WPSuite\Hub\AdminNavigation(new \SmartCloud\WPSuite\Hub\HubAdmin());
$restricted->registerMenus();
$restrictedData = $restricted->topNavigationData();
check($restrictedData !== null && count($restrictedData['groups']) === 1 && $restrictedData['groups'][0]['links'][0]['label'] === 'Patterns', 'Editor receives only accessible Patterns navigation, never admin settings.');
$GLOBALS['plugin_page'] = 'gatey'; $GLOBALS['pagenow'] = 'admin.php'; $_GET = array('page' => 'gatey');
check($restricted->topNavigationData() === null, 'Permission-filtered legacy detail screen does not get navigation.');
$permissions = array();
check($navigation->topNavigationData() === null, 'Navigation respects read permission at rendering time.');
echo "Admin top navigation contract checks passed.\n";
