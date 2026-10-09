<?php
/** Included only by the disposable, offline seven-plugin integration fixture. */
if (!isset($wpRoot) || !preg_match('~^/tmp/wpsuite-surfaces\.[^/]+/wordpress$~D', $wpRoot)) { exit(1); }

function reset_request(string $method, string $id, ?array $body = null, bool $nonce = true): WP_REST_Response {
    $request = new WP_REST_Request($method, '/smartcloud-wpsuite/v1/admin-resets/' . $id);
    if ($nonce) { $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest')); }
    if ($body !== null) { $request->set_header('content-type', 'application/json'); $request->set_body(wp_json_encode($body)); }
    return rest_do_request($request);
}

$resetIds = array('login-access', 'answers', 'forms-workflows', 'ai-editing', 'static-publishing', 'consent', 'content-relations');
foreach ($resetIds as $id) { surface_assert(reset_request('GET', $id)->get_status() === 403, $id . ' reset review rejects anonymous users'); }
wp_set_current_user($statusOnlyId);
foreach ($resetIds as $id) { surface_assert(reset_request('POST', $id, array('confirm' => true, 'revision' => str_repeat('a', 64)))->get_status() === 403, $id . ' reset rejects restricted users'); }
wp_set_current_user(1);

$review = reset_request('GET', 'login-access')->get_data();
surface_assert(isset($review['revision']) && strlen($review['revision']) === 64 && count($review['consequences']) > 0, 'Reset review exposes bounded revision and consequences');
surface_assert(!str_contains(wp_json_encode($review), 'Secondary') && !str_contains(wp_json_encode($review), 'fixtureclient'), 'Reset review never exposes stored pool configuration');
$before = get_option('gatey');
foreach (array(array('confirm' => false, 'revision' => $review['revision']), array('confirm' => 'true', 'revision' => $review['revision']), array('confirm' => true, 'revision' => $review['revision'], 'options' => array('blogname'))) as $body) {
    surface_assert(reset_request('POST', 'login-access', $body)->get_status() === 400, 'Reset requires exact explicit confirmation contract');
}
surface_assert(reset_request('POST', 'login-access', array('confirm' => true, 'revision' => $review['revision']), false)->get_status() === 403, 'Reset requires a valid WordPress REST nonce');
surface_assert(get_option('gatey') == $before, 'Denied reset requests preserve every Gatey setting');
$changed = clone $before;
$changed->secondaryUserPoolDomains = '^changed\\.example\\.test$';
update_option('gatey', $changed);
surface_assert(reset_request('POST', 'login-access', array('confirm' => true, 'revision' => $review['revision']))->get_status() === 409, 'Advanced secondary configuration change invalidates reset confirmation');
surface_assert(get_option('gatey') == $changed, 'Stale confirmation preserves changed secondary configuration');

global $wpdb;
$contentIds = $wpdb->get_col("SELECT p.ID FROM {$wpdb->posts} p WHERE p.post_type <> 'smartcloud_composer' AND NOT (p.post_type = 'revision' AND p.post_parent IN (SELECT c.ID FROM {$wpdb->posts} c WHERE c.post_type = 'smartcloud_composer')) ORDER BY p.ID");
$contentQuery = "SELECT ID, post_type, post_content, post_status FROM {$wpdb->posts} WHERE ID IN (" . implode(',', array_map('intval', $contentIds)) . ') ORDER BY ID';
$postsBefore = $wpdb->get_results($contentQuery, ARRAY_A);
$usersBefore = $wpdb->get_results("SELECT ID, user_login FROM {$wpdb->users} ORDER BY ID", ARRAY_A);
$siteBefore = get_option('smartcloud-wpsuite/site-settings');
$remoteBefore = get_option(SmartCloud\WPSuite\Hub\WPSUITE_CONFIG_OPTION);
update_option('unrelated_plugin_configuration', array('keep' => true));

// Existing fixture queued a publish job. Reset must refuse it, not cancel it.
$publisherReview = reset_request('GET', 'static-publishing')->get_data();
$queueBefore = $publisherPlugin->readQueue();
surface_assert(reset_request('POST', 'static-publishing', array('confirm' => true, 'revision' => $publisherReview['revision']))->get_status() === 409, 'Publisher refuses reset while a job is queued');
surface_assert($publisherPlugin->readQueue() === $queueBefore, 'Publisher refusal preserves queued jobs');
// Only this disposable fixture removes its synthetic job; no actual publishing runs.
$runtimePaths = $publisherPlugin->getRuntimePaths();
file_put_contents($runtimePaths['queue'], wp_json_encode(array()));

$descriptors = array_column(apply_filters('smartcloud_wpsuite_admin_capabilities', array()), null, 'id');
update_option('smartcloud_ai_kit_answers_setup_completed', true, false);
foreach ($resetIds as $id) {
    $response = reset_request('GET', $id);
    surface_assert($response->get_status() === 200, $id . ' provides an independent reset review even without onboarding steps');
    $review = $response->get_data();
    $otherState = array();
    foreach ($resetIds as $other) {
        if ($other !== $id) { $otherState[$other] = SmartCloud\WPSuite\Hub\ConfigurationReset::optionRevision($descriptors[$other]['configuration_reset']['options']); }
    }
    $response = reset_request('POST', $id, array('confirm' => true, 'revision' => $review['revision']));
    surface_assert($response->get_status() === 200 && ($response->get_data()['reset'] ?? false) === true, $id . ' confirmed reset succeeds: ' . wp_json_encode($response->get_data()));
    foreach ($otherState as $other => $revision) { surface_assert($revision === SmartCloud\WPSuite\Hub\ConfigurationReset::optionRevision($descriptors[$other]['configuration_reset']['options']), $id . ' preserves ' . $other . ' configuration'); }
}
surface_assert(get_option('gatey', null) === null, 'Gatey full reset removes primary/secondary pools, regexp, integration and advanced fields');
surface_assert(get_option('smartcloud-flow', null) === null, 'Flow reset clears complete preferences');
surface_assert($repository->list_config_sets() === array(), 'Composer reset removes configuration sets so preset onboarding is available again');
surface_assert(!surface_read('ai-editing')['configured'], 'Composer returns to unconfigured status after reset');
$answersAfterReset = surface_read('answers');
surface_assert(answers_onboarding_request('GET')->get_data() === array('completed' => false), 'Explicit AI-Kit reset clears the recorded onboarding completion');
surface_assert(!$answersAfterReset['configured'] && $answersAfterReset['status']['state'] === 'needs_setup', 'Answers returns to setup-needed after reset even with preserved source history');
surface_assert($postsBefore === $wpdb->get_results($contentQuery, ARRAY_A), 'All seven resets preserve ordinary posts, pages, reusable blocks and proposals');
surface_assert($usersBefore === $wpdb->get_results("SELECT ID, user_login FROM {$wpdb->users} ORDER BY ID", ARRAY_A), 'All seven resets preserve WordPress accounts');
surface_assert(get_option('smartcloud-wpsuite/site-settings') === $siteBefore && get_option(SmartCloud\WPSuite\Hub\WPSUITE_CONFIG_OPTION) === $remoteBefore, 'All seven resets preserve shared site connection and encrypted Pro configuration');
surface_assert(get_option('unrelated_plugin_configuration') === array('keep' => true), 'Unrelated plugin configuration survives');
surface_assert($httpAttempts === 0, 'All seven resets make no external HTTP or AWS calls');
