<?php
/** Real full-plugin integration. Run only with surface-wordpress.sh. */
declare(strict_types=1);

$wpRoot = $argv[1] ?? '';
$scenario = $argv[2] ?? '';
if (!preg_match('~^/tmp/wpsuite-surfaces\.[^/]+/wordpress$~D', $wpRoot)) throw new RuntimeException('Disposable runner directory required.');
$completed = false;
register_shutdown_function(static function () use (&$completed): void { if (!$completed) { fwrite(STDERR, "Surface integration did not finish.\n"); exit(1); } });
$_SERVER['HTTP_HOST'] = 'surfaces.test';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/wp-admin/index.php';
$_SERVER['PHP_SELF'] = '/wp-admin/index.php';
define('WP_ADMIN', true);
if ($scenario === 'install') define('WP_INSTALLING', true);
require $wpRoot . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/admin.php';
if ($scenario === 'install') {
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    wp_install('Surface test', 'surface-admin', 'admin@example.test', false, '', wp_generate_password());
    wp_set_current_user(1);
    foreach (array('gatey', 'smartcloud-ai-kit', 'smartcloud-flow', 'smartcloud-static-publisher', 'smartcloud-agent-composer', 'smartcloud-consent', 'smartcloud-content-relations') as $slug) {
        $result = activate_plugin($slug . '/' . $slug . '.php');
        if (is_wp_error($result)) throw new RuntimeException($slug . ': ' . $result->get_error_message());
    }
    echo "Installed disposable WordPress and activated seven real plugins.\n";
    $completed = true;
    exit;
}

$checks = 0;
function surface_assert(bool $value, string $message): void {
    global $checks;
    ++$checks;
    if (!$value) throw new RuntimeException('FAIL: ' . $message);
}
function surface_request(string $method, string $id, ?array $body = null, bool $action = false): WP_REST_Response {
    $request = new WP_REST_Request($method, '/smartcloud-wpsuite/v1/admin-surfaces/' . $id . ($action ? '/action' : ''));
    $request->set_header('x_wp_nonce', wp_create_nonce('wp_rest'));
    if ($body !== null) {
        $request->set_header('content-type', 'application/json');
        $request->set_body(wp_json_encode($body));
    }
    return rest_do_request($request);
}
function surface_read(string $id): array {
    $response = surface_request('GET', $id);
    surface_assert($response->get_status() === 200, $id . ' GET succeeds: ' . wp_json_encode($response->get_data()));
    $surface = $response->get_data();
    surface_assert(($surface['schema_version'] ?? null) === 1 && is_bool($surface['configured'] ?? null) && is_array($surface['steps'] ?? null), $id . ' schema projected by real hub');
    return $surface;
}
function composer_request(string $method, string $route, array $body = array()): WP_REST_Response {
    $request = new WP_REST_Request($method, '/smartcloud-agent-composer/v1/' . $route);
    $request->set_header('x_wp_nonce', wp_create_nonce('wp_rest'));
    if ($body) { $request->set_header('content-type', 'application/json'); $request->set_body(wp_json_encode($body)); }
    return rest_do_request($request);
}

wp_set_current_user(1);
if ($scenario === 'cache-check') {
    $candidateQueries = 0;
    add_action('pre_get_posts', static function (WP_Query $query) use (&$candidateQueries): void { if ($query->get('posts_per_page') === 201 && $query->get('fields') === 'ids') ++$candidateQueries; });
    rest_get_server();
    $usage = surface_read('login-access')['use_on_site']['items'][1];
    surface_assert($candidateQueries === 0 && str_contains($usage['status'], '2 inspected published'), 'Placement transient is reused by a second PHP request without persistent object cache');
    echo "Second-request placement cache passed.\n";
    $completed = true;
    exit;
}
surface_assert(current_user_can(SmartCloud\AgentComposer\Infrastructure\WordPress\Activation::CAP_EDIT_CONFIG), 'Real Composer activation installed admin capabilities');
rest_get_server();
foreach (array('answers', 'ai-tools', 'ai-editing', 'login-access', 'forms-workflows', 'static-publishing') as $id) {
    $surface = surface_read($id);
    $topics = array_column($surface['help'] ?? array(), null, 'id');
    surface_assert(count($topics) === count($surface['help'] ?? array()) && count($topics) <= 32, $id . ' help IDs are unique and bounded through real projection');
    $references = array_merge($surface['metrics'], $surface['steps'], $surface['use_on_site']['items'] ?? array());
    foreach ($surface['steps'] as $step) $references = array_merge($references, $step['fields']);
    foreach ($references as $item) if (isset($item['help_id'])) surface_assert(isset($topics[$item['help_id']]), $id . ' real contextual help reference resolves: ' . $item['help_id']);
    if (in_array($id, array('answers', 'ai-tools'), true)) {
        surface_assert(($surface['runtime_plugin'] ?? '') === 'aiKit', $id . ' preserves case-sensitive runtime plugin key through real REST projection');
        surface_assert(in_array('backendTransport', array_column($surface['runtime_fields'] ?? array(), 'path'), true), $id . ' retains safe read-only Pro fields through real REST projection');
    }
}
foreach (array('smartcloud-flow' => 'forms-workflows', 'smartcloud-ai-kit' => 'ai-tools') as $option => $id) {
    foreach (array(new stdClass(), array()) as $empty) {
        update_option($option, $empty);
        $surface = surface_read($id);
        surface_assert(!$surface['configured'] && $surface['can_edit'] && ($id === 'forms-workflows' ? $surface['steps'] === array() : count($surface['steps']) > 0), $id . ' empty ' . get_debug_type($empty) . ' retains the appropriate onboarding or informational surface');
        if ($id === 'forms-workflows') surface_assert($surface['status']['state'] === 'ready' && $surface['status']['label'] === 'Flow blocks available' && $surface['can_setup'] === false, 'Fresh Flow does not advertise a nonexistent setup wizard');
    }
}

$httpAttempts = 0;
add_filter('pre_http_request', static function () use (&$httpAttempts) { ++$httpAttempts; return new WP_Error('offline_test', 'External HTTP is disabled.'); });
// Pro data is opaque to the local surfaces. A sentinel in the real encrypted
// configuration option must survive every operation byte-for-byte.
$proCache = 'opaque-pro-configuration-fixture-do-not-rewrite';
update_option(SmartCloud\WPSuite\Hub\WPSUITE_CONFIG_OPTION, $proCache, false);

$answersFresh = surface_read('answers');
surface_assert(!$answersFresh['configured'] && $answersFresh['status']['state'] === 'needs_setup' && $answersFresh['can_setup'] && !$answersFresh['can_edit'], 'Fresh Answers exposes its custom setup on Overview without allowing generic PATCH');
function answers_onboarding_request(string $method, ?array $body = null, bool $nonce = true): WP_REST_Response {
    $request = new WP_REST_Request($method, '/smartcloud-ai-kit/v1/answers-onboarding');
    if ($nonce) $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest'));
    if ($body !== null) { $request->set_header('content-type', 'application/json'); $request->set_body(wp_json_encode($body)); }
    return rest_do_request($request);
}
surface_assert(answers_onboarding_request('GET')->get_data() === array('completed' => false), 'Fresh Answers has no recorded wizard completion');
$beforeCompletionHttp = $httpAttempts;
surface_assert(answers_onboarding_request('POST', array('completed' => true), false)->get_status() === 403, 'Recording Answers completion requires a REST nonce');
surface_assert(answers_onboarding_request('POST', array('completed' => false))->get_status() === 400, 'Completion endpoint cannot silently reset onboarding');
surface_assert(answers_onboarding_request('POST', array('completed' => true))->get_data() === array('completed' => true), 'Completing Answers without enabling features records the explicit decision');
wp_cache_delete('smartcloud_ai_kit_answers_setup_completed', 'options');
wp_cache_delete('alloptions', 'options');
surface_assert(answers_onboarding_request('GET')->get_data() === array('completed' => true), 'Completion survives database reload and WordPress option scalar normalization');
$answersCompleted = surface_read('answers');
surface_assert($answersCompleted['configured'] && $answersCompleted['status']['state'] === 'ready' && $answersCompleted['status']['label'] === 'Setup completed', 'Overview distinguishes completed opt-out from an untouched installation');
surface_assert($httpAttempts === $beforeCompletionHttp, 'Local completion does not contact a cloud backend or require a site connection');
delete_option('smartcloud_ai_kit_answers_setup_completed');
update_option('smartcloud_ai_kit_kb_sync_policies', array('page' => array('enabled' => true, 'reviewPolicy' => 'manual-kb-review')));
$answersSelected = surface_read('answers');
surface_assert($answersSelected['configured'] && $answersSelected['status']['state'] === 'ready', 'Selected canonical knowledge policy completes source setup even before any sources exist');
delete_option('smartcloud_ai_kit_kb_sync_policies');

$gatey = SmartCloud\WPSuite\Gatey\Settings::fromMixed(false);
$gatey->userPoolConfigurations->default->Auth->Cognito->userPoolId = 'eu-central-1_Fixture';
$gatey->userPoolConfigurations->default->Auth->Cognito->userPoolClientId = 'fixtureclient123';
$gatey->userPoolConfigurations->secondary->Auth->Cognito->userPoolId = 'eu-central-1_Secondary';
$gatey->userPoolConfigurations->secondary->Auth->Cognito->userPoolClientId = 'secondaryclient123';
$gatey->secondaryUserPoolDomains = '^members\\.example\\.test$';
$gatey->userPoolConfigurations->default->Auth->Cognito->identityPoolId = 'preserved-identity';
$gatey->userPoolConfigurations->default->Auth->Cognito->loginWith->oauth->scopes = array('openid', 'email');
$gatey->loginMechanisms = array('email', 'username');
$gatey->passwordlessSettings = array('allowedFirstAuthFactors' => array('PASSWORD', 'WEB_AUTHN'));
$gatey->integrateWpLogin = true;
$gatey->mappings = array(new SmartCloud\WPSuite\Gatey\RoleMapping('fixture-group', 'subscriber'));
update_option('gatey', $gatey);
foreach (array('login-access', 'forms-workflows', 'ai-editing') as $introId) {
    $intro = surface_read($introId)['introduction'] ?? null;
    surface_assert(is_array($intro) && !empty($intro['title']) && !empty($intro['description']), $introId . ' introduction survives REST normalization');
    surface_assert(count($intro['items'] ?? array()) >= 3, $introId . ' includes useful first steps and service requirements');
    foreach ($intro['items'] as $item) surface_assert(!empty($item['title']) && !empty($item['description']), $introId . ' introduction cards retain their explanatory content');
}
$surface = surface_read('login-access');
$expectedGatey = unserialize(serialize($gatey));
$expectedGatey->userPoolConfigurations->default->Auth->Cognito->userPoolClientId = 'updatedclient123';
$expectedGatey->userPoolConfigurations->default->API->GraphQL->region = 'eu-central-1';
$response = surface_request('PATCH', 'login-access', array('revision' => $surface['revision'], 'values' => array('userPoolClientId' => 'updatedclient123')));
surface_assert($response->get_status() === 200, 'Real Gatey partial save succeeds: ' . wp_json_encode($response->get_data()));
surface_assert(serialize(get_option('gatey')) === serialize($expectedGatey), 'Gatey typed secondary pool, OAuth, mappings and passwordless settings preserved');
surface_assert(surface_request('PATCH', 'login-access', array('revision' => $surface['revision'], 'values' => array('hideSignUp' => true)))->get_status() === 409, 'Gatey stale revision rejected');

// Wizard connection fields survive hub normalization and patch only the default pool.
$surface = surface_read('login-access');
$fields = array_column($surface['steps'][0]['fields'], null, 'id');
surface_assert(!isset($fields['region']) && isset($fields['identityPoolId']) && empty($fields['identityPoolId']['required']), 'Gatey REST projection exposes optional Identity Pool but no automatic region field');
$identityPool = 'us-east-1:01234567-89ab-cdef-0123-456789abcdef';
$connectionValues = array('userPoolId' => 'eu-west-1_Updated', 'userPoolClientId' => 'updatedclient123', 'identityPoolId' => $identityPool);
$response = surface_request('PATCH', 'login-access', array('revision' => $surface['revision'], 'values' => $connectionValues));
surface_assert($response->get_status() === 200, 'Gatey wizard accepts optional Identity Pool in another region');
$expectedGatey->userPoolConfigurations->default->Auth->Cognito->userPoolId = 'eu-west-1_Updated';
$expectedGatey->userPoolConfigurations->default->Auth->Cognito->identityPoolId = $identityPool;
$expectedGatey->userPoolConfigurations->default->API->GraphQL->region = 'eu-west-1';
surface_assert(serialize(get_option('gatey')) === serialize($expectedGatey), 'Real connection save derives verifier region and preserves integration, roles and secondary pool');
$surface = surface_read('login-access');
surface_assert(!property_exists($surface['values'], 'region') && $surface['values']->identityPoolId === $identityPool, 'Saved Identity Pool reloads without exposing the derived region');
$response = surface_request('PATCH', 'login-access', array('revision' => $surface['revision'], 'values' => array('region' => 'us-east-1')));
surface_assert($response->get_status() === 400 && serialize(get_option('gatey')) === serialize($expectedGatey), 'A region-only patch has no supported setting and cannot alter the saved configuration');
$response = surface_request('PATCH', 'login-access', array('revision' => $surface['revision'], 'values' => array('userPoolId' => 'ap-southeast-2_Changed', 'region' => 'ap-southeast-2')));
surface_assert($response->get_status() === 400 && serialize(get_option('gatey')) === serialize($expectedGatey), 'Cached wizard fields reject the whole patch without writes until the field contract is reloaded');

// Native settings saves also derive both pool regions, including old clients
// that still submit the obsolete editable region. Preserve independent identity
// pools, OAuth, roles and all other settings through the real REST handler.
$nativePayload = json_decode(wp_json_encode($expectedGatey), true);
$nativePayload['userPoolConfigurations']['secondary']['Auth']['Cognito']['userPoolId'] = 'ap-southeast-2_Secondary';
$nativePayload['userPoolConfigurations']['secondary']['Auth']['Cognito']['identityPoolId'] = $identityPool;
$nativePayload['userPoolConfigurations']['secondary']['Auth']['Cognito']['loginWith']['oauth']['scopes'] = array('openid', 'profile');
$nativePayload['userPoolConfigurations']['default']['API']['GraphQL']['region'] = 'us-east-1';
unset($nativePayload['userPoolConfigurations']['secondary']['API']['GraphQL']['region']);
$expectedNative = $nativePayload;
$expectedNative['userPoolConfigurations']['default']['API']['GraphQL']['region'] = 'eu-west-1';
$expectedNative['userPoolConfigurations']['secondary']['API']['GraphQL']['region'] = 'ap-southeast-2';
function gatey_settings_request(array $payload): WP_REST_Response {
    $request = new WP_REST_Request('POST', '/gatey/v1/update-settings');
    $request->set_header('x_wp_nonce', wp_create_nonce('wp_rest'));
    $request->set_header('content-type', 'application/json');
    $request->set_body(wp_json_encode($payload));
    return rest_do_request($request);
}
$response = gatey_settings_request($nativePayload);
surface_assert($response->get_status() === 200, 'Native Gatey REST accepts stale or absent client region');
surface_assert(json_decode(wp_json_encode(get_option('gatey')), true) === $expectedNative, 'Native REST derives each pool region independently and preserves other settings');
$nativePayload = $expectedNative;
$nativePayload['userPoolConfigurations']['secondary']['Auth']['Cognito']['userPoolId'] = '';
$expectedNative = $nativePayload;
$expectedNative['userPoolConfigurations']['secondary']['API']['GraphQL']['region'] = '';
$response = gatey_settings_request($nativePayload);
surface_assert($response->get_status() === 200 && json_decode(wp_json_encode(get_option('gatey')), true) === $expectedNative, 'Clearing the secondary pool clears its derived region without changing unrelated identity, OAuth or role settings');
surface_assert(get_option(SmartCloud\WPSuite\Hub\WPSUITE_CONFIG_OPTION) === $proCache, 'Native pool saves leave independent Pro backend configuration unchanged');
// Restore this scenario's pool fixture for the subsequent placement tests.
update_option('gatey', $expectedGatey);

// Published-page autocomplete is exercised against the real offline database and
// REST permission layer. These fixtures exist only in this disposable test site.
function gatey_page_request(mixed $query): WP_REST_Response {
    $request = new WP_REST_Request('GET', '/gatey/v1/admin/page-suggestions');
    $request->set_header('x_wp_nonce', wp_create_nonce('wp_rest'));
    $request->set_param('q', $query);
    return rest_do_request($request);
}
function gatey_fixture_page(string $title, string $slug, string $status = 'publish', int $parent = 0, string $type = 'page'): int {
    $id = wp_insert_post(array('post_title' => $title, 'post_name' => $slug, 'post_type' => $type, 'post_status' => $status, 'post_parent' => $parent), true);
    surface_assert(!is_wp_error($id), 'Disposable Gatey page fixture created');
    return (int) $id;
}
$memberPage = gatey_fixture_page('Gatey member access fixture', 'gatey-sign-in-fixture');
$parentPage = gatey_fixture_page('Gatey members fixture', 'gatey-members-fixture');
$nestedPage = gatey_fixture_page('Gatey nested access fixture', 'login', 'publish', $parentPage);
$otherParent = gatey_fixture_page('Gatey staff fixture', 'gatey-staff-fixture');
$otherNested = gatey_fixture_page('Gatey other access fixture', 'login', 'publish', $otherParent);
$htmlPage = gatey_fixture_page('<b>Gatey safe &amp; clear fixture</b>', 'gatey-safe-fixture');
$literalPage = gatey_fixture_page("Gatey literal %_ quote' fixture", 'gatey-literal-fixture');
$excludedPages = array(
    gatey_fixture_page('Gatey excluded fixture draft', 'gatey-excluded-draft', 'draft'),
    gatey_fixture_page('Gatey excluded fixture private', 'gatey-excluded-private', 'private'),
    gatey_fixture_page('Gatey excluded fixture trash', 'gatey-excluded-trash', 'trash'),
    gatey_fixture_page('Gatey excluded fixture post', 'gatey-excluded-post', 'publish', 0, 'post'),
);
for ($number = 0; $number < 25; ++$number) gatey_fixture_page('Gatey bounded fixture ' . $number, 'gatey-bounded-' . $number);
$longTitlePage = gatey_fixture_page(str_repeat('😀', 600), 'gatey-long-title-fixture');
$deepParent = gatey_fixture_page('Gatey long URI first fixture', 'gatey-deep-' . str_repeat('a', 180));
$deepChild = gatey_fixture_page('Gatey long URI second fixture', 'gatey-deep-' . str_repeat('b', 180), 'publish', $deepParent);
$longUriPage = gatey_fixture_page('Gatey long URI third fixture', 'gatey-deep-' . str_repeat('c', 180), 'publish', $deepChild);
$gateySurface = surface_read('login-access');
$pathField = $gateySurface['steps'][1]['fields'][1] ?? array();
surface_assert(($pathField['type'] ?? '') === 'text' && ($pathField['suggestions_url'] ?? '') === rest_url('gatey/v1/admin/page-suggestions'), 'Real hub projection retains backward-compatible text field and suggestion URL');
$response = surface_request('PATCH', 'login-access', array('revision' => $gateySurface['revision'], 'values' => array('signInPage' => '/handwritten-signin-fixture/')));
surface_assert($response->get_status() === 200 && $response->get_data()['values']->signInPage === '/handwritten-signin-fixture/', 'Manual path persists without matching an existing page');
$gateySearchSnapshot = serialize(get_option('gatey'));
$gateySearchRevision = $response->get_data()['revision'];
global $wpdb;
$pageRowsBefore = $wpdb->get_results("SELECT ID, post_title, post_name, post_status, post_parent, post_content, post_modified_gmt FROM {$wpdb->posts} ORDER BY ID", ARRAY_A);
foreach (array(
    'Gatey member access fixture' => 'gatey-sign-in-fixture',
    'gatey-sign-in-fixture' => 'gatey-sign-in-fixture',
    (string) $memberPage => 'gatey-sign-in-fixture',
    (string) $nestedPage => 'gatey-members-fixture/login',
    '/gatey-members-fixture/login/' => 'gatey-members-fixture/login',
    'gatey-members-fixture/log' => 'gatey-members-fixture/login',
) as $query => $expectedUri) {
    $response = gatey_page_request((string) $query);
    surface_assert($response->get_status() === 200, 'Gatey real title/slug/ID/path search succeeds: ' . $query);
    $uris = array_column($response->get_data(), 'value');
    surface_assert(ctype_digit((string) $query) ? ($uris[0] ?? '') === $expectedUri : $uris === array($expectedUri), 'Gatey real search returns matching hierarchical relative path, prioritizing exact ID: ' . $query);
}
$response = gatey_page_request('login');
surface_assert($response->get_status() === 200 && in_array('gatey-members-fixture/login', array_column($response->get_data(), 'value'), true) && in_array('gatey-staff-fixture/login', array_column($response->get_data(), 'value'), true), 'Leaf slug can suggest both published hierarchies');
$response = gatey_page_request((string) $htmlPage);
surface_assert($response->get_status() === 200 && $response->get_data()[0]['label'] === 'Gatey safe & clear fixture · gatey-safe-fixture · #' . $htmlPage, 'HTML title is returned as plain decoded label text');
$response = gatey_page_request((string) $longTitlePage);
$longLabel = $response->get_data()[0]['label'] ?? '';
surface_assert($response->get_status() === 200 && $longLabel !== '' && strlen($longLabel) <= 1024 && preg_match('//u', $longLabel) === 1, 'Real long Unicode page title remains bounded valid UTF-8');
$response = gatey_page_request((string) $longUriPage);
surface_assert(strlen(get_page_uri($longUriPage)) > 512 && $response->get_status() === 200 && !in_array(get_page_uri($longUriPage), array_column($response->get_data(), 'value'), true), 'Oversized real hierarchical URI is omitted instead of breaking autocomplete');
$response = gatey_page_request("%_ quote'");
surface_assert($response->get_status() === 200 && array_column($response->get_data(), 'value') === array('gatey-literal-fixture'), 'Real SQL search treats wildcards and quotes as literal characters: ' . wp_json_encode(array('response' => $response->get_data(), 'title' => get_the_title($literalPage))));
foreach (array('Gatey excluded fixture', 'no-matching-gatey-page-fixture') as $query) {
    $response = gatey_page_request($query);
    surface_assert($response->get_status() === 200 && $response->get_data() === array(), 'Only published pages can be suggested, including exact-ID lookups: ' . $query);
}
foreach ($excludedPages as $excludedId) {
    $response = gatey_page_request((string) $excludedId);
    surface_assert($response->get_status() === 200 && !in_array(get_page_uri($excludedId), array_column($response->get_data(), 'value'), true), 'Unpublished pages and nonpage exact IDs cannot appear in suggestions');
}
$response = gatey_page_request('Gatey bounded fixture');
surface_assert($response->get_status() === 200 && count($response->get_data()) === 20, 'Real endpoint enforces twenty-result maximum');
surface_assert(gatey_page_request(array('bad'))->get_status() === 400, 'REST schema rejects array search');
surface_assert(gatey_page_request(str_repeat('x', 201))->get_status() === 400, 'REST schema rejects oversized search');
foreach (array('editor', 'subscriber') as $role) {
    $searchUser = wp_insert_user(array('user_login' => 'gatey-search-' . $role, 'user_pass' => wp_generate_password(), 'role' => $role));
    surface_assert(!is_wp_error($searchUser), 'Disposable search role fixture created');
    wp_set_current_user($searchUser);
    surface_assert(gatey_page_request('fixture')->get_status() === 403, 'Gatey suggestions denied to ' . $role);
}
wp_set_current_user(0);
surface_assert(gatey_page_request('fixture')->get_status() === 403, 'Anonymous page search denied');
wp_set_current_user(1);
surface_assert(serialize(get_option('gatey')) === $gateySearchSnapshot && surface_read('login-access')['revision'] === $gateySearchRevision, 'Read-only suggestions leave local configuration and revision unchanged');
surface_assert($wpdb->get_results("SELECT ID, post_title, post_name, post_status, post_parent, post_content, post_modified_gmt FROM {$wpdb->posts} ORDER BY ID", ARRAY_A) === $pageRowsBefore, 'Suggestions do not write page records or content');
surface_assert(get_option(SmartCloud\WPSuite\Hub\WPSUITE_CONFIG_OPTION) === $proCache, 'Page search never writes Pro configuration');

// Configured-page placement includes bounded published synced patterns.
$placementSettings = get_option('gatey');
$placementSettings->signInPage = get_page_uri($memberPage);
update_option('gatey', $placementSettings);
wp_update_post(array('ID' => $memberPage, 'post_content' => '<!-- wp:gatey/authenticator /-->'));
$placement = surface_read('login-access')['use_on_site']['items'][0];
surface_assert(str_contains($placement['status'], 'Authenticator block detected on the configured WordPress page') && str_contains($placement['status'], get_page_uri($memberPage)), 'Real block parser detects Authenticator at the configured path');
surface_assert(in_array(get_edit_post_link($memberPage, 'raw'), array_column($placement['links'], 'url'), true), 'Selected published page exposes its native edit destination');
surface_assert($placement['links'][0]['label'] === 'Edit sign-in page' && !in_array('Create sign-in page', array_column($placement['links'], 'label'), true), 'Detected placement leads to editing instead of redundant creation');
$sharedBlock = wp_insert_post(array('post_title' => 'Disposable login pattern', 'post_type' => 'wp_block', 'post_status' => 'publish', 'post_content' => '<!-- wp:gatey/authenticator /-->'));
wp_update_post(array('ID' => $memberPage, 'post_content' => '<!-- wp:block {"ref":' . $sharedBlock . '} /-->'));
$placement = surface_read('login-access')['use_on_site']['items'][0];
surface_assert(str_contains($placement['status'], 'Authenticator block detected'), 'Real core/block reference expands its published synced pattern');
$placementSurface = surface_read('login-access');
$placementHelp = array_column($placementSurface['help'], null, 'id');
surface_assert(str_contains(implode(' ', $placementHelp['authenticator-placement']['paragraphs']), 'Site templates and other placement methods are not inspected'), 'Detection scope is available in contextual help');
wp_update_post(array('ID' => $sharedBlock, 'post_content' => '<!-- wp:block {"ref":' . $sharedBlock . '} /-->'));
$placement = surface_read('login-access')['use_on_site']['items'][0];
surface_assert(str_contains($placement['status'], 'inspection incomplete') && $placement['links'][0]['label'] === 'Add Authenticator to sign-in page', 'Real synced cycle stops safely and offers the missing placement step without claiming absence');
wp_update_post(array('ID' => $sharedBlock, 'post_content' => '<!-- wp:paragraph --><p>No sign-in screen</p><!-- /wp:paragraph -->'));
$placement = surface_read('login-access')['use_on_site']['items'][0];
surface_assert(str_contains($placement['status'], 'No Authenticator block detected on the configured WordPress page'), 'Inspected configured location is named explicitly when its block is missing');
$placementSettings->signInPage = '/manual-unresolved-fixture/'; update_option('gatey', $placementSettings);
$placement = surface_read('login-access')['use_on_site']['items'][0];
surface_assert($placement['links'][0]['label'] === 'Create sign-in page' && !in_array('Preview sign-in', array_column($placement['links'], 'label'), true), 'Unresolved path offers creation and does not advertise a broken preview');
update_option('show_on_front', 'page'); update_option('page_on_front', $nestedPage);
wp_update_post(array('ID' => $nestedPage, 'post_content' => '<!-- wp:gatey/authenticator /-->'));
$placementSettings->signInPage = '/'; update_option('gatey', $placementSettings);
$beforePlacement = serialize(get_option('gatey'));
$placement = surface_read('login-access')['use_on_site']['items'][0];
surface_assert(str_contains($placement['status'], 'Authenticator block detected') && in_array(get_edit_post_link($nestedPage, 'raw'), array_column($placement['links'], 'url'), true), 'Root path resolves the published static front page');
surface_assert(serialize(get_option('gatey')) === $beforePlacement, 'Native-use reads do not mutate local settings');

$profilePage = gatey_fixture_page('Account display fixture', 'account-display-fixture');
$profilePost = gatey_fixture_page('Account post fixture', 'account-post-fixture', 'publish', 0, 'post');
$draftProfile = gatey_fixture_page('Draft account fixture', 'draft-account-fixture', 'draft');
$profilePattern = gatey_fixture_page('Account synced fixture', 'account-synced-fixture', 'publish', 0, 'wp_block');
wp_update_post(array('ID' => $profilePattern, 'post_content' => '<!-- wp:gatey/account-attribute {"attribute":"email"} /-->'));
wp_update_post(array('ID' => $profilePage, 'post_content' => '<!-- wp:gatey/account-attribute {"attribute":"given_name"} /-->'));
wp_update_post(array('ID' => $profilePost, 'post_content' => '<!-- wp:block {"ref":' . $profilePattern . '} /-->'));
wp_update_post(array('ID' => $draftProfile, 'post_content' => '<!-- wp:gatey/account-attribute /-->'));
$candidateQueries = 0;
add_action('pre_get_posts', static function (WP_Query $query) use (&$candidateQueries): void { if ($query->get('posts_per_page') === 201 && $query->get('fields') === 'ids') ++$candidateQueries; });
$beforeUsage = serialize(get_option('gatey'));
$usage = surface_read('login-access')['use_on_site']['items'][1];
surface_assert(str_contains($usage['status'], '2 inspected published pages or posts') && $candidateQueries === 1, 'Real usage finds published page and synced post, excluding draft and standalone pattern');
surface_assert(in_array(get_edit_post_link($profilePage, 'raw'), array_column($usage['links'], 'url'), true) && in_array(get_edit_post_link($profilePost, 'raw'), array_column($usage['links'], 'url'), true), 'Usage offers native permission-checked edit links');
surface_read('login-access');
surface_assert($candidateQueries === 1 && serialize(get_option('gatey')) === $beforeUsage, 'Repeated usage read reuses bounded cache without changing Gatey configuration');
$process = proc_open(array(PHP_BINARY, __FILE__, $wpRoot, 'cache-check'), array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
surface_assert(is_resource($process), 'Second disposable PHP request starts');
$childOutput = stream_get_contents($pipes[1]); $childError = stream_get_contents($pipes[2]); fclose($pipes[1]); fclose($pipes[2]);
surface_assert(proc_close($process) === 0 && str_contains($childOutput, 'Second-request placement cache passed'), 'Real transient survives separate requests: ' . $childOutput . $childError);
$usageReader = wp_insert_user(array('user_login' => 'usage-reader', 'user_pass' => wp_generate_password(), 'role' => 'subscriber'));
surface_assert(!is_wp_error($usageReader), 'Disposable usage reader created');
$reader = new WP_User($usageReader); $reader->add_cap('manage_options'); wp_set_current_user($usageReader);
$usage = surface_read('login-access')['use_on_site']['items'][1];
surface_assert($usage['links'] === array() && str_contains($usage['status'], '2 inspected published'), 'Cached usage does not leak editor links to a settings-only user');
$reader->add_cap('edit_pages'); $reader->add_cap('edit_published_pages'); $reader->add_cap('edit_others_pages'); wp_set_current_user(0); wp_set_current_user($usageReader);
$usage = surface_read('login-access')['use_on_site']['items'][1];
surface_assert(in_array(get_edit_post_link($profilePage, 'raw'), array_column($usage['links'], 'url'), true) && !in_array(admin_url('post.php?post=' . $profilePost . '&action=edit'), array_column($usage['links'], 'url'), true), 'Cached usage recomputes page versus post edit permissions for the current user');
wp_set_current_user(1);
wp_update_post(array('ID' => $profilePattern, 'post_content' => ''));
surface_assert(str_contains(surface_read('login-access')['use_on_site']['items'][1]['status'], '1 inspected published') && $candidateQueries === 2, 'Changing a real synced pattern invalidates cached usage');
wp_update_post(array('ID' => $profilePage, 'post_status' => 'draft'));
surface_assert(str_contains(surface_read('login-access')['use_on_site']['items'][1]['status'], 'No Account Attribute block found') && $candidateQueries === 3, 'Status transitions invalidate published usage');
wp_delete_post($profilePost, true);
surface_read('login-access');
surface_assert($candidateQueries === 4, 'Deleting published content invalidates usage cache');
echo "Gatey placement: real blocks, synced cycles, second-request cache, invalidation and user permissions passed.\n";

$flow = array('enablePoweredBy' => false, 'formsBackendSyncEnabled' => false, 'formsAllowPermanentDelete' => true, 'highlightedSubmissionActions' => array('completed'), 'defaultOutputLanguage' => 'fr', 'unknownAdvanced' => array('preserve' => true));
update_option('smartcloud-flow', $flow);
$surface = surface_read('forms-workflows');
surface_assert($surface['status']['label'] === 'Form preferences configured', 'Real Flow saved preference status does not imply backend readiness');
surface_assert($surface['steps'] === array(), 'Flow uses block guidance rather than a preference-only wizard');
surface_assert(surface_request('PATCH', 'forms-workflows', array('revision' => $surface['revision'], 'values' => array('enablePoweredBy' => true)))->get_status() === 400, 'Retired Flow wizard cannot write undisplayed preferences');
surface_assert(get_option('smartcloud-flow') === $flow, 'Flow advanced fields remain unchanged after a forged retired wizard save');
$flowPattern = wp_insert_post(array('post_type' => 'wp_block', 'post_status' => 'publish', 'post_title' => 'Flow usage fixture', 'post_content' => '<!-- wp:smartcloud-flow/modal {} /--><!-- wp:smartcloud-flow/gallery {} /-->'));
$flowPage = wp_insert_post(array('post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Flow usage page', 'post_content' => '<!-- wp:smartcloud-flow/form {} /--><!-- wp:smartcloud-flow/form {} /--><!-- wp:block {"ref":' . $flowPattern . '} /-->'));
$flowPost = wp_insert_post(array('post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'Flow usage post', 'post_content' => '<!-- wp:smartcloud-flow/form {} /-->'));
wp_insert_post(array('post_type' => 'page', 'post_status' => 'draft', 'post_title' => 'Flow hidden draft', 'post_content' => '<!-- wp:smartcloud-flow/form {} /-->'));
$flowUsage = array_column(surface_read('forms-workflows')['use_on_site']['items'], null, 'id');
surface_assert(str_contains($flowUsage['form']['status'], '2 inspected published pages or posts'), 'Real Flow usage counts containing published pages/posts rather than repeated block instances');
surface_assert(str_contains($flowUsage['modal']['status'], '1 inspected published pages or posts') && str_contains($flowUsage['gallery']['status'], '1 inspected published pages or posts'), 'Real Flow usage traverses published synchronized patterns');
$flowQueries = 0;
add_action('pre_get_posts', static function (WP_Query $query) use (&$flowQueries): void { if ($query->get('posts_per_page') === 201 && $query->get('fields') === 'ids') ++$flowQueries; });
surface_read('forms-workflows');
surface_assert($flowQueries === 0, 'Flow cards reuse the bounded cached usage scan');
wp_update_post(array('ID' => $flowPattern, 'post_content' => '<!-- wp:smartcloud-flow/discussion {} /-->'));
$flowUsage = array_column(surface_read('forms-workflows')['use_on_site']['items'], null, 'id');
surface_assert($flowQueries === 1 && str_contains($flowUsage['modal']['status'], '0 inspected') && str_contains($flowUsage['discussion']['status'], '1 inspected'), 'Pattern modification invalidates Flow usage and updates each block count');
wp_delete_post($flowPost, true);
surface_assert(str_contains(surface_read('forms-workflows')['use_on_site']['items'][0]['status'], '1 inspected'), 'Deleting a published Flow placement invalidates the scan');
surface_assert(array_sum(array_map(static fn(array $item): int => count($item['links']), $flowUsage)) === 1, 'Flow guidance provides one Patterns link without repeated generic page actions');
echo "Flow placement: real published blocks, synchronized patterns, cache and invalidation passed.\n";

$ai = array('defaultOutputLanguage' => 'fr', 'enablePoweredBy' => false, 'debugLoggingEnabled' => true, 'unknownAdvanced' => array('retain' => 'unchanged'));
update_option('smartcloud-ai-kit', $ai);
$surface = surface_read('ai-tools');
$expectedAi = $ai; $expectedAi['defaultOutputLanguage'] = 'de';
surface_assert(surface_request('PATCH', 'ai-tools', array('revision' => $surface['revision'], 'values' => array('defaultOutputLanguage' => 'de')))->get_status() === 200, 'Real AI Tools partial save succeeds');
surface_assert(get_option('smartcloud-ai-kit') === $expectedAi, 'AI Tools advanced fields preserved exactly');
surface_assert(surface_request('PATCH', 'ai-tools', array('revision' => $surface['revision'], 'values' => array('enablePoweredBy' => true)))->get_status() === 409, 'AI Tools stale revision rejected');
surface_assert(surface_request('PATCH', 'answers', array('revision' => 'unused', 'values' => array('enableChatbot' => true)))->get_status() === 403, 'Answers configuration remains read-only');

$publisherPlugin = SmartCloud\WPSuite\StaticPublisher\Plugin::instance();
$publisher = $publisherPlugin->sanitizeConfig(array('targetOrigin' => 'https://static.example.test', 'outputDir' => 'surface-fixture', 's3' => array('bucket' => 'fixture-publishing-bucket', 'region' => 'eu-central-1', 'prefix' => 'test', 'assetCacheControl' => 'public,max-age=500'), 'cloudFront' => array('distributionId' => 'EXAMPLE', 'invalidationPaths' => array('/preserved/*')), 'extraReplacements' => array('custom' => 'preserved'), 'blockedPathPrefixes' => array('/wp-admin', '/private')));
update_option('smartcloud_static_publisher_config', $publisher);
$surface = surface_read('static-publishing');
$expectedPublisher = $publisher; $expectedPublisher['s3']['prefix'] = 'updated-prefix';
$response = surface_request('PATCH', 'static-publishing', array('revision' => $surface['revision'], 'values' => array('prefix' => 'updated-prefix')));
surface_assert($response->get_status() === 200, 'Real Publisher partial save succeeds: ' . wp_json_encode($response->get_data()));
surface_assert(get_option('smartcloud_static_publisher_config') === $expectedPublisher, 'Publisher nested advanced storage, CloudFront and crawl values preserved');
surface_assert(surface_request('PATCH', 'static-publishing', array('revision' => $surface['revision'], 'values' => array('prefix' => 'stale')))->get_status() === 409, 'Publisher stale revision rejected');
$response = surface_request('POST', 'static-publishing', array('action' => 'publish', 'input' => array()), true);
surface_assert($response->get_status() === 403, 'Retired one-click publishing action is unavailable; explicit modal choices use canonical jobs');
$publishRequest = new WP_REST_Request('POST', '/smartcloud-static-publisher/v1/jobs');
$publishRequest->set_header('x_wp_nonce', wp_create_nonce('wp_rest'));
$publishRequest->set_header('content-type', 'application/json');
$publishRequest->set_body(wp_json_encode(array('command' => 'publish', 'crawlMode' => 'full')));
$response = rest_do_request($publishRequest);
surface_assert(in_array($response->get_status(), array(200, 202), true), 'Full publish queued through real canonical controller: ' . wp_json_encode($response->get_data()));
$queue = $publisherPlugin->readQueue();
surface_assert(count($queue) === 1 && $queue[0]['command'] === 'publish' && $queue[0]['crawlMode'] === 'full', 'Only a disposable full publication job queued; no exporter executes');

$surface = surface_read('ai-editing');
surface_assert(!$surface['configured'], 'Composer starts without canonical configuration');
surface_assert($surface['can_edit'] && $surface['steps'] === array() && (array) $surface['values'] === array(), 'Authorized simple Composer actions have no configuration wizard or editable settings');
$actions = array_column($surface['actions'], null, 'id');
surface_assert(array_keys($actions) === array('start-preset') && array_column($actions['start-preset']['fields'], 'id') === array('preset'), 'First-time starter exposes only a preset choice; discovery remains in detailed settings');
surface_assert(in_array('universal-gutenberg', array_column($actions['start-preset']['fields'][0]['options'], 'value'), true), 'Canonical available starter catalog reaches the real simple action');
$repository = new SmartCloud\AgentComposer\Infrastructure\Persistence\WordPressConfigurationRepository();
surface_assert(surface_request('POST', 'ai-editing', array('action' => 'rescan-site', 'input' => array()), true)->get_status() === 403, 'Retired summary rescan cannot be invoked by a stale client');
$response = composer_request('POST', 'discovery');
surface_assert($response->get_status() === 201, 'Detailed rescan invokes canonical discovery: ' . wp_json_encode($response->get_data()));
$discovery = get_option('smartcloud_composer_last_discovery');
$discoveryEntity = $repository->find_entity('site-discovery', 'discovery', $discovery['key'] ?? '');
surface_assert(is_array($discovery) && !empty($discovery['fingerprint']) && $discoveryEntity instanceof WP_Post, 'Canonical discovery snapshot and reference persist through the detailed rescan');
surface_assert($repository->list_config_sets() === array() && !surface_read('ai-editing')['configured'], 'Discovery does not invent an editing configuration or suppress the first-time starter');
$response = surface_request('PATCH', 'ai-editing', array('revision' => $surface['revision'], 'values' => array('preset' => 'universal-gutenberg', 'label' => 'Legacy wizard')));
surface_assert($response->get_status() === 403 && $repository->list_config_sets() === array(), 'Legacy simple wizard PATCH is rejected without creating a configuration');
$response = surface_request('POST', 'ai-editing', array('action' => 'start-preset', 'input' => array('preset' => 'universal-gutenberg')), true);
surface_assert($response->get_status() === 200, 'Explicit first-time starter instantiates the existing canonical preset: ' . wp_json_encode($response->get_data()));
surface_assert(($response->get_data()['redirect'] ?? '') === admin_url('admin.php?page=smartcloud-agent-composer&section=configuration'), 'Starter continues to existing Advanced configuration management');
surface_assert(get_option('smartcloud_composer_active_config_set', '') === '', 'Starter action never activates its configuration');
$sets = $repository->list_config_sets(); $draft = $sets[0]['config_set'] ?? '';
surface_assert(count($sets) === 1 && $draft !== '', 'Starter creates exactly one canonical inactive configuration');
$surface = surface_read('ai-editing');
surface_assert($surface['configured'] && $surface['actions'] === array() && $surface['steps'] === array(), 'Any inactive configuration suppresses starter and clone/rename wizard');
$beforeInactive = $repository->configuration_hash($draft);
foreach (array('start-preset' => array('preset' => 'universal-gutenberg'), 'validate' => array('config_set' => $draft), 'activate' => array('config_set' => $draft)) as $action => $input) {
    surface_assert(surface_request('POST', 'ai-editing', array('action' => $action, 'input' => $input), true)->get_status() === 403, 'Simple surface refuses unavailable or legacy action: ' . $action);
}
surface_assert(count($repository->list_config_sets()) === 1 && $repository->configuration_hash($draft) === $beforeInactive && get_option('smartcloud_composer_active_config_set', '') === '', 'Rejected starter/validation/activation requests preserve inactive canonical data');
// Detailed Composer routes retain their existing governed configuration lifecycle.
$response = composer_request('POST', 'config-sets/' . rawurlencode($draft) . '/validate');
surface_assert($response->get_status() === 200 && !empty($response->get_data()['valid']), 'Advanced canonical draft validation remains available');
$response = composer_request('POST', 'config-sets/' . rawurlencode($draft) . '/activate');
surface_assert($response->get_status() === 200 && get_option('smartcloud_composer_active_config_set') === $draft, 'Advanced explicit activation retains its governed behavior');
$beforeActive = $repository->configuration_hash($draft);
$surface = surface_read('ai-editing');
$response = surface_request('PATCH', 'ai-editing', array('revision' => $surface['revision'], 'values' => array('label' => 'Safe working copy')));
surface_assert($response->get_status() === 403 && count($repository->list_config_sets()) === 1, 'Simple PATCH cannot clone or rename an active configuration');
$discoveryBefore = get_option('smartcloud_composer_last_discovery');
$response = composer_request('POST', 'discovery');
surface_assert($response->get_status() === 201 && get_option('smartcloud_composer_last_discovery')['key'] !== $discoveryBefore['key'], 'Rescan refreshes the canonical discovery snapshot even with active configuration');
surface_assert(get_option('smartcloud_composer_active_config_set') === $draft && $repository->configuration_hash($draft) === $beforeActive && count($repository->list_config_sets()) === 1, 'Rescan preserves active canonical entities and creates no clone');
$response = composer_request('POST', 'config-sets/' . rawurlencode($draft) . '/clone', array('label' => 'Advanced working copy'));
surface_assert($response->get_status() === 201 && count($repository->list_config_sets()) === 2, 'Existing Advanced clone route remains available separately');
$copySets = array_values(array_filter($repository->list_config_sets(), static fn(array $set): bool => $set['config_set'] !== $draft));
$copyId = $copySets[0]['config_set'];
foreach ($repository->describe_config_set($draft)['entities'] as $entity) {
    if ($entity['type'] === 'config-set') continue;
    $copyEntity = $repository->find_entity($copyId, $entity['type'], $entity['key']);
    surface_assert($copyEntity !== null && $repository->describe_entity($copyEntity)['payload'] === $entity['payload'], 'Working copy preserves full advanced payload: ' . $entity['type']);
}

// Native private capability pages must invoke their actual renderer and assets.
$GLOBALS['pagenow'] = 'admin.php';
set_current_screen('dashboard');
require ABSPATH . 'wp-admin/menu.php';
foreach (array('consent' => 'smartcloud-consent-admin', 'content-relations' => 'smartcloud-content-relations-admin') as $id => $mount) {
    $hook = get_plugin_page_hookname('smartcloud-wpsuite-capability-' . $id, 'smartcloud-wpsuite');
    surface_assert(has_action($hook) !== false, $id . ' native capability callback registered');
    ob_start(); do_action($hook); $html = ob_get_clean();
    surface_assert(str_contains($html, $mount), $id . ' original native renderer retained');
    set_current_screen($hook);
    do_action('admin_enqueue_scripts', $hook);
    surface_assert(wp_script_is($mount, 'enqueued'), $id . ' own admin assets load on capability route');
    surface_assert(wp_script_is('smartcloud-wpsuite-admin-script', 'enqueued') && str_contains($html, 'id="wpsuite-config-reset"'), $id . ' native route mounts the shared reset control alongside its own admin');
}

$advanced = 'smartcloud-wpsuite-advanced';
$navigation = null;
foreach ($GLOBALS['wp_filter']['admin_menu']->callbacks as $callbacks) {
    foreach ($callbacks as $callback) {
        $handler = $callback['function'];
        if (is_array($handler) && $handler[0] instanceof SmartCloud\WPSuite\Hub\AdminNavigation) $navigation = $handler[0];
    }
}
surface_assert($navigation !== null, 'Real navigation owner is available');
// Overview verifies backend access without mounting either product's full editor.
// Readiness assets must come from the real assembled package, never test fixtures.
$overviewHook = get_plugin_page_hookname('smartcloud-wpsuite', 'smartcloud-wpsuite');
$_GET = array('page' => 'smartcloud-wpsuite');
$GLOBALS['plugin_page'] = 'smartcloud-wpsuite';
set_current_screen($overviewHook);
foreach (array('smartcloud-ai-kit-admin-script', 'smartcloud-flow-admin-script', 'smartcloud-ai-kit-backend-check', 'smartcloud-flow-backend-check') as $handle) {
    wp_dequeue_script($handle);
}
$navigation->enqueueNative($overviewHook);
foreach (array('smartcloud-ai-kit' => array(SMARTCLOUD_AI_KIT_PATH, SMARTCLOUD_AI_KIT_URL), 'smartcloud-flow' => array(SMARTCLOUD_FLOW_PATH, SMARTCLOUD_FLOW_URL)) as $slug => [$pluginPath, $pluginUrl]) {
    $handle = $slug . '-backend-check';
    surface_assert(wp_script_is($handle, 'enqueued'), $slug . ' Overview enqueues its lightweight backend readiness adapter');
    surface_assert(!wp_script_is($slug . '-admin-script', 'enqueued'), $slug . ' Overview does not enqueue the full native admin UI');
    $assetPath = $pluginPath . 'admin/backend-readiness.asset.php';
    surface_assert(is_file($assetPath) && is_file($pluginPath . 'admin/backend-readiness.js'), $slug . ' readiness assets exist in the canonical plugin package');
    $asset = require $assetPath;
    $registered = wp_scripts()->registered[$handle];
    surface_assert($registered->src === $pluginUrl . 'admin/backend-readiness.js', $slug . ' readiness script resolves to its packaged asset URL');
    surface_assert(in_array($slug . '-main-script', $registered->deps, true) && wp_script_is($slug . '-main-script', 'registered'), $slug . ' readiness script depends on the real registered plugin runtime');
    surface_assert(array_diff($asset['dependencies'] ?? array(), $registered->deps) === array(), $slug . ' readiness script retains every generated dependency');
}
$tools = $navigation->bootstrap($advanced)['capabilities'];
foreach (array('login-access' => array('smartcloud-gatey-admin', 'smartcloud-gatey-admin-script'), 'forms-workflows' => array('smartcloud-flow-admin', 'smartcloud-flow-admin-script'), 'ai-editing' => array('smartcloud-composer-admin', 'smartcloud-composer-admin')) as $id => [$mount, $script]) {
    $tool = array_column($tools, null, 'id')[$id];
    surface_assert($tool['has_details'] === true, $id . ' authorized detailed editor is projected');
    $slug = 'smartcloud-wpsuite-capability-' . $id;
    $hook = get_plugin_page_hookname($slug, 'smartcloud-wpsuite');
    $_GET = array('page' => $slug); $GLOBALS['plugin_page'] = $slug; set_current_screen($hook);
    ob_start(); do_action($hook); $html = ob_get_clean();
    surface_assert(str_contains($html, 'data-navigation=') && str_contains($html, 'id="wpsuite-product-details"') && str_contains($html, 'data-wpsuite-product="' . $id . '"') && str_contains($html, 'id="' . $mount . '"'), $id . ' shared summary and real native editor coexist without an iframe');
    do_action('admin_enqueue_scripts', $hook);
    surface_assert(wp_script_is($script, 'enqueued'), $id . ' native assets enqueue through integrated detail callback');
}

surface_assert((array_column($tools, null, 'id')['answers']['surface_extension'] ?? '') === 'answers', 'Optional Answers extension survives real navigation projection');
surface_assert(array_column($tools, 'id') === array('answers', 'ai-tools', 'ai-editing', 'forms-workflows', 'login-access', 'static-publishing', 'consent', 'content-relations'), 'Real installed-tool order keeps private Overview cards');
$visibleRows = array_values(array_filter($GLOBALS['submenu']['smartcloud-wpsuite'], static fn(array $row): bool => !str_contains($row[4] ?? '', 'wpsuite-legacy-destination') && !str_contains($row[4] ?? '', 'wpsuite-secondary-destination')));
surface_assert(array_column($visibleRows, 0) === array('Overview', 'Answers', 'AI Editing', 'Forms & Workflows', 'Login & Access', 'Static Publishing', 'Platform Settings'), 'Real visible primary menu order omits private tools: ' . wp_json_encode(array_column($visibleRows, 0))); 
foreach (array('login-access' => array('authenticator', 'account-attribute'), 'ai-tools' => array('post-editor', 'media-library', 'ai-feature'), 'forms-workflows' => array('form', 'discussion', 'rating', 'modal', 'gallery', 'content-root')) as $toolId => $items) {
    $use = surface_read($toolId)['use_on_site'] ?? null;
    surface_assert(is_array($use) && array_column($use['items'], 'id') === $items, $toolId . ' supplies projected native-use cards');
}
$projectedUrls = array();
foreach ($navigation->bootstrap($advanced)['capabilities'] as $capability) {
    $projectedUrls = array_merge($projectedUrls, array_column($capability['advanced_links'], 'url'));
}
$advancedUrls = array();
foreach (apply_filters('smartcloud_wpsuite_admin_capabilities', array()) as $descriptor) {
    foreach ($descriptor['advanced_links'] ?? array() as $link) {
        $advancedUrls[$link['url']] ??= 'smartcloud-wpsuite-capability-' . ($descriptor['id'] === 'ai-tools' ? 'answers' : $descriptor['id']);
        if (str_contains($link['url'], '&section=')) surface_assert(in_array($link['url'], $projectedUrls, true), 'Subsection survives real permission-filtered navigation projection: ' . $link['url']);
    }
}
$advancedUrls[admin_url('admin.php?page=smartcloud-wpsuite-settings')] = 'smartcloud-wpsuite-settings';
foreach ($advancedUrls as $url => $expectedProduct) {
    $parts = wp_parse_url($url);
    $_GET = array(); parse_str($parts['query'] ?? '', $_GET);
    $GLOBALS['pagenow'] = basename($parts['path']);
    $GLOBALS['plugin_page'] = $_GET['page'] ?? null;
    set_current_screen($GLOBALS['pagenow'] === 'edit.php' ? 'edit-wp_block' : ($_GET['page'] ?? 'dashboard'));
    $current = $_GET['page'] ?? 'edit.php?post_type=wp_block';
    surface_assert(apply_filters('submenu_file', $current) === $expectedProduct, 'Detailed/Patterns destination highlights its product: ' . $url);
    surface_assert(apply_filters('parent_file', $GLOBALS['pagenow']) === 'smartcloud-wpsuite', 'Detailed/Patterns destination keeps WP Suite parent: ' . $url);
    if (isset($_GET['page'])) surface_assert(has_action(get_plugin_page_hookname($_GET['page'], 'smartcloud-wpsuite')) !== false, 'Legacy detailed callback remains registered: ' . $_GET['page']);
}
foreach (array('answers', 'ai-tools', 'ai-editing', 'login-access', 'forms-workflows', 'static-publishing', 'consent', 'content-relations') as $id) {
    $slug = 'smartcloud-wpsuite-capability-' . $id;
    $_GET = array('page' => $slug);
    $GLOBALS['pagenow'] = 'admin.php'; $GLOBALS['plugin_page'] = $slug;
    set_current_screen($slug);
    surface_assert(apply_filters('submenu_file', $slug) === $slug, $id . ' tool menu highlights its destination');
}
$_GET = array('post_type' => 'wp_block', 's' => 'unrelated');
$GLOBALS['pagenow'] = 'edit.php'; $GLOBALS['plugin_page'] = null;
set_current_screen('edit-wp_block');
surface_assert(apply_filters('parent_file', 'edit.php?post_type=wp_block') === 'edit.php?post_type=wp_block', 'Unrelated Patterns searches keep native WordPress parent');
$_GET = array();

surface_assert(get_option(SmartCloud\WPSuite\Hub\WPSUITE_CONFIG_OPTION) === $proCache, 'All local saves and actions leave canonical Pro cache untouched');
surface_assert($httpAttempts === 0, 'All tested onboarding/read/save/queue paths make no external HTTP requests');

$statusOnlyId = wp_insert_user(array('user_login' => 'surface-status', 'user_pass' => wp_generate_password(), 'role' => 'subscriber'));
$statusUser = new WP_User($statusOnlyId);
$statusUser->add_cap(SmartCloud\AgentComposer\Infrastructure\WordPress\Activation::CAP_VIEW_STATUS);
wp_set_current_user($statusOnlyId);
$surface = surface_read('ai-editing');
surface_assert(!$surface['can_edit'] && !$surface['actions'], 'Composer status-only user sees no mutations');
surface_assert(surface_request('PATCH', 'ai-editing', array('revision' => $surface['revision'], 'values' => array('label' => 'Forbidden')))->get_status() === 403, 'Status-only cannot create draft');
$statusUser->add_cap(SmartCloud\AgentComposer\Infrastructure\WordPress\Activation::CAP_EDIT_CONFIG);
wp_set_current_user(0); wp_set_current_user($statusOnlyId);
surface_assert(surface_read('ai-editing')['actions'] === array(), 'Configuration editing permission alone does not grant rescan or restore first-time starter');
surface_assert(surface_request('POST', 'ai-editing', array('action' => 'rescan-site', 'input' => array()), true)->get_status() === 403, 'Forged rescan denied without canonical discovery permission');
$statusUser->add_cap(SmartCloud\AgentComposer\Infrastructure\WordPress\Activation::CAP_VALIDATE_CONFIG);
wp_set_current_user(0); wp_set_current_user($statusOnlyId);
$restricted = surface_read('ai-editing');
surface_assert($restricted['actions'] === array(), 'Discovery permission does not restore a summary rescan action');
surface_assert(composer_request('POST', 'discovery')->get_status() === 201, 'Authorized restricted user can rescan through the canonical discovery API');
surface_assert(surface_request('POST', 'ai-editing', array('action' => 'activate', 'input' => array('config_set' => $copyId)), true)->get_status() === 403, 'Forged activation denied despite editing and validation capabilities');
surface_assert(composer_request('POST', 'config-sets/' . rawurlencode($copyId) . '/activate')->get_status() === 403, 'Advanced activation still requires its dedicated permission');
$statusUser->remove_cap(SmartCloud\AgentComposer\Infrastructure\WordPress\Activation::CAP_EDIT_CONFIG);
wp_set_current_user(0); wp_set_current_user($statusOnlyId);
$restricted = surface_read('ai-editing');
surface_assert($restricted['can_edit'] && $restricted['steps'] === array() && $restricted['actions'] === array(), 'Discovery-only users have no summary mutation action or settings wizard');
surface_assert(composer_request('POST', 'discovery')->get_status() === 201, 'Detailed discovery accepts rescan with its own canonical capability');
surface_assert(composer_request('GET', 'presets')->get_status() === 403, 'Discovery permission grants no access to configuration preset management');
foreach (array('answers', 'ai-tools', 'login-access', 'forms-workflows', 'static-publishing') as $id) surface_assert(surface_request('GET', $id)->get_status() === 403, $id . ' denied to nonadministrator');
wp_set_current_user(0);
surface_assert(surface_request('GET', 'ai-editing')->get_status() === 403, 'Anonymous user cannot read Composer status');
surface_assert(answers_onboarding_request('POST', array('completed' => true))->get_status() === 403, 'Anonymous user cannot mark Answers setup completed');

require __DIR__ . '/configuration-reset-wordpress.php';
echo "Full-plugin surface integration: {$checks} checks passed.\n";
$completed = true;
