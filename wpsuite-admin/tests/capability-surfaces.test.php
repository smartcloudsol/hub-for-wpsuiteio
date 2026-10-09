<?php
declare(strict_types=1);
define('ABSPATH', __DIR__ . '/');
class WP_Error {
    public function __construct(public string $code, public string $message, public array $data = array()) {}
}
class WP_REST_Request implements ArrayAccess {
    public function __construct(private string $id, private array $body = array()) {}
    public function offsetExists(mixed $offset): bool { return $offset === 'id'; }
    public function offsetGet(mixed $offset): mixed { return $this->id; }
    public function offsetSet(mixed $offset, mixed $value): void {}
    public function offsetUnset(mixed $offset): void {}
    public function get_json_params(): array { return $this->body; }
}
function __(string $value, string $domain = ''): string { return $value; }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function current_user_can(string $cap): bool { return in_array($cap, $GLOBALS['caps'], true); }
function apply_filters(string $filter, mixed $value): mixed { return $GLOBALS['descriptors']; }
function admin_url(): string { return 'https://site.test/wp-admin/'; }
function wp_parse_url(string $url): array|false { return parse_url($url); }
function surface_check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
require dirname(__DIR__) . '/php/capability-surfaces.php';
$caps = array('manage_options');
$writes = 0;
$actions = 0;
$surface = array(
    'schema_version' => 1, 'configured' => false, 'can_edit' => true, 'revision' => 'first',
    'status' => array('state' => 'needs_setup', 'label' => 'Set up'), 'notice' => '',
    'metrics' => array(), 'values' => array('title' => 'Existing', 'enabled' => true, 'hiddenAdvanced' => 'do-not-expose'),
    'steps' => array(array('id' => 'basic', 'title' => 'Basics', 'fields' => array(
        array('id' => 'title', 'label' => 'Title', 'type' => 'text'),
        array('id' => 'enabled', 'label' => 'Enabled', 'type' => 'checkbox'),
    ))),
    'actions' => array(array('id' => 'run', 'label' => 'Run', 'fields' => array())),
    'links' => array(array('label' => 'Safe', 'url' => 'https://site.test/wp-admin/admin.php?page=test'), array('label' => 'Unsafe', 'url' => 'https://foreign.test/')),
    'internal_configuration' => array('sensitive' => 'do-not-expose'),
);
$descriptor = array('schema_version' => 1, 'id' => 'test', 'required_capability' => 'manage_options',
    'surface_provider' => static fn() => $GLOBALS['surface'],
    'surface_save' => static function (array $values, string $revision) {
        if ($revision !== $GLOBALS['surface']['revision']) return new WP_Error('conflict', 'Reload', array('status' => 409));
        ++$GLOBALS['writes'];
        $GLOBALS['surface']['values'] = array_merge($GLOBALS['surface']['values'], $values);
        $GLOBALS['surface']['revision'] = 'second';
        return $GLOBALS['surface'];
    },
    'surface_action' => static function (string $action, array $input) { ++$GLOBALS['actions']; return array('message' => 'Queued', 'severity' => 'warning', 'redirect' => 'https://foreign.test/', 'private' => 'do-not-expose'); },
);
$descriptors = array($descriptor);
$api = new SmartCloud\WPSuite\Hub\CapabilitySurfaces();
$result = $api->read(new WP_REST_Request('test'));
surface_check(!is_wp_error($result) && count($result['links']) === 1, 'Read projects safe links');
surface_check(!str_contains(json_encode($result), 'do-not-expose'), 'Unlisted values and provider internals must not escape');
$caps = array('read');
surface_check($api->read(new WP_REST_Request('test'))->data['status'] === 403, 'Read capability enforced without menu dependency');
surface_check($api->save(new WP_REST_Request('test', array('values' => array('title' => 'x'), 'revision' => 'first')))->data['status'] === 403, 'Write denied without capability');
$caps = array('manage_options');
foreach (array(array('pro' => true), array('hiddenAdvanced' => 'overwrite'), array('enabled' => 'false'), array('title' => array('bad'))) as $bad) {
    surface_check($api->save(new WP_REST_Request('test', array('values' => $bad, 'revision' => 'first')))->data['status'] === 400, 'Reject unlisted fields and invalid scalar types');
}
surface_check($writes === 0, 'Invalid inputs invoke no plugin mutation');
$result = $api->save(new WP_REST_Request('test', array('values' => array('title' => 'Updated'), 'revision' => 'first')));
surface_check(!is_wp_error($result) && $writes === 1 && $result['values']->enabled === true, 'Valid patch updates only selected values');
surface_check($surface['values']['hiddenAdvanced'] === 'do-not-expose', 'Unlisted advanced state retained');
surface_check($api->save(new WP_REST_Request('test', array('values' => array('title' => 'Stale'), 'revision' => 'first')))->data['status'] === 409, 'Provider concurrency conflict survives REST adapter');
surface_check($api->action(new WP_REST_Request('test', array('action' => 'unknown', 'input' => array())))->data['status'] === 403, 'Unknown actions are not dispatched');
surface_check($api->action(new WP_REST_Request('test', array('action' => 'run', 'input' => array('hidden' => true))))->data['status'] === 400, 'Action input allowlist enforced');
$result = $api->action(new WP_REST_Request('test', array('action' => 'run', 'input' => array())));
surface_check($actions === 1 && $result === array('message' => 'Queued', 'severity' => 'warning'), 'Action projects safe public response only');
$surface['can_edit'] = false;
$surface['can_setup'] = true;
$setupProjection = $api->read(new WP_REST_Request('test'));
surface_check($setupProjection['can_setup'] === true && $setupProjection['can_edit'] === false, 'Custom wizard setup permission survives independently of generic editing');
surface_check($api->save(new WP_REST_Request('test', array('values' => array(), 'revision' => 'second')))->data['status'] === 403, 'Read-only Pro/state surfaces cannot save');
$surface['can_setup'] = false;
surface_check($api->read(new WP_REST_Request('test'))['can_setup'] === false, 'Explicit false setup permission survives projection');
foreach (array(null, 0, 1, 'true', array()) as $invalidSetupPermission) {
    $surface['can_setup'] = $invalidSetupPermission;
    surface_check($api->read(new WP_REST_Request('test'))->data['status'] === 500, 'Setup permission must be boolean whenever present');
}
unset($surface['can_setup']);
surface_check(!array_key_exists('can_setup', $api->read(new WP_REST_Request('test'))), 'Older providers keep their existing generic-edit setup behavior');
$descriptors = array($descriptor, array_replace($descriptor, array('required_capability' => 'read')));
surface_check($api->read(new WP_REST_Request('test'))->data['status'] === 409, 'Conflicting registrations fail closed');
$descriptors = array(array_replace($descriptor, array('schema_version' => 2)));
surface_check($api->read(new WP_REST_Request('test'))->data['status'] === 404, 'Unknown provider schema is unavailable');
$descriptors = array($descriptor);
$validSurface = $surface;
foreach (array('metrics', 'steps', 'actions', 'links', 'runtime_fields', 'values') as $key) {
    $surface = array_replace($validSurface, array($key => 'unsupported'));
    surface_check($api->read(new WP_REST_Request('test'))->data['status'] === 500, 'Malformed provider collections fail without a PHP warning');
}
$surface = $validSurface;
$surface['steps'][0]['fields'][0]['options'] = 'unsupported';
surface_check($api->read(new WP_REST_Request('test'))->data['status'] === 500, 'Malformed field options fail without a PHP warning');
$surface = $validSurface;
$surface['steps'][0]['fields'][0]['suggestions_url'] = 'https://site.test/wp-json/gatey/v1/page-suggestions';
$result = $api->read(new WP_REST_Request('test'));
surface_check(!is_wp_error($result) && $result['steps'][0]['fields'][0]['suggestions_url'] === 'https://site.test/wp-json/gatey/v1/page-suggestions', 'Safe page lookup URL survives the rich-field projection');
foreach (array('https://foreign.test/suggestions', '//foreign.test/suggestions', 'javascript:alert(1)', array('url' => '/suggestions')) as $unsafe) {
    $surface['steps'][0]['fields'][0]['suggestions_url'] = $unsafe;
    surface_check($api->read(new WP_REST_Request('test'))->data['status'] === 500, 'Unsafe or malformed lookup endpoint fails closed');
}
$surface = $validSurface;
$surface['steps'][0]['fields'][1]['suggestions_url'] = 'https://site.test/wp-json/gatey/v1/page-suggestions';
surface_check($api->read(new WP_REST_Request('test'))->data['status'] === 500, 'Only text fields may declare suggestion endpoints');
$surface = $validSurface;
$surface['values'] = (object) $surface['values'];
surface_check(!is_wp_error($api->read(new WP_REST_Request('test'))), 'Plain object values are supported');
$surface = $validSurface;
$surface['runtime_plugin'] = 'aiKit';
$surface['runtime_fields'] = array(array('label' => 'Assistant', 'path' => 'enableChatbot', 'format' => 'boolean'));
$result = $api->read(new WP_REST_Request('test'));
surface_check($result['runtime_plugin'] === 'aiKit' && count($result['runtime_fields']) === 1, 'Canonical camelCase runtime configuration keys are preserved');
$surface = $validSurface;
$siteUse = array('description' => 'Add native blocks in the editor.', 'private' => 'do-not-expose', 'items' => array(array(
    'id' => 'form', 'title' => 'Flow Form', 'description' => 'Choose Flow Form in the inserter.', 'status' => 'Configured page: /sign-in/',
    'links' => array(array('label' => 'Open editor', 'url' => 'https://site.test/wp-admin/post-new.php?post_type=page', 'private' => 'do-not-expose'),
        array('label' => 'Foreign', 'url' => 'https://foreign.test/page'), array('label' => 'Credentials', 'url' => 'https://user:pass@site.test/page'),
        array('label' => 'Protocol', 'url' => 'javascript:alert(1)'), array('label' => 'Unsafe shape', 'url' => array('bad'))),
    'actions' => array(array('id' => 'insert', 'private' => 'do-not-expose')), 'private' => 'do-not-expose',
)));
$surface['use_on_site'] = $siteUse;
$surface['can_edit'] = true;
$beforeWrites = $writes; $beforeActions = $actions;
$result = $api->read(new WP_REST_Request('test'));
surface_check(!is_wp_error($result) && count($result['use_on_site']['items'][0]['links']) === 1, 'Placement guidance retains only safe same-site editor links');
surface_check(array_keys($result['use_on_site']) === array('description', 'items') && array_keys($result['use_on_site']['items'][0]) === array('id', 'title', 'description', 'links', 'status'), 'Placement projection explicitly allowlists public fields');
surface_check(!str_contains(json_encode($result), 'do-not-expose') && $result['actions'] === $api->read(new WP_REST_Request('test'))['actions'], 'Unknown placement state and actions never become public mutation controls');
surface_check($api->action(new WP_REST_Request('test', array('action' => 'insert', 'input' => array())))->data['status'] === 403, 'Invented placement action is never dispatched');
surface_check($writes === $beforeWrites && $actions === $beforeActions, 'Reading guidance invokes no configuration or action mutation');
$caps = array('read');
surface_check($api->read(new WP_REST_Request('test'))->data['status'] === 403, 'Placement guidance uses the existing provider read permission');
$caps = array('manage_options');
$item = $siteUse['items'][0];
$badUses = array(null, 'unsupported', array_replace($siteUse, array('description' => false)), array_replace($siteUse, array('description' => str_repeat('x', 4097))),
    array_replace($siteUse, array('items' => 'unsupported')), array_replace($siteUse, array('items' => array($item, $item))),
    array_replace($siteUse, array('items' => array_map(static fn(int $index): array => array_replace($item, array('id' => 'form-' . $index)), range(0, 12)))));
foreach (array(array('id' => 'Form'), array('id' => str_repeat('x', 65)), array('title' => false), array('title' => str_repeat('x', 257)),
    array('description' => null), array('description' => str_repeat('x', 4097)), array('status' => false), array('status' => str_repeat('x', 1025)),
    array('links' => 'unsupported'), array('links' => array_fill(0, 9, $item['links'][0]))) as $changes) {
    $badUses[] = array_replace($siteUse, array('items' => array(array_replace($item, $changes))));
}
foreach ($badUses as $badUse) {
    $surface = array_replace($validSurface, array('use_on_site' => $badUse));
    surface_check($api->read(new WP_REST_Request('test'))->data['status'] === 500, 'Malformed optional placement guidance fails closed without escaping partial data');
}
$surface = array_replace($validSurface, array('use_on_site' => array('description' => 'Guidance only', 'items' => array(array_replace($item, array('links' => array(), 'status' => null))))));
$result = $api->read(new WP_REST_Request('test'));
surface_check(!is_wp_error($result) && $result['use_on_site']['items'][0]['links'] === array() && !isset($result['use_on_site']['items'][0]['status']), 'Permission-filtered cards retain guidance without editor links or a fabricated status');
$surface = $validSurface;
$topic = array('id' => 'form-placement', 'title' => 'Add a form', 'summary' => 'Choose a destination.', 'paragraphs' => array('Open the WordPress editor.', '<img src=x onerror=alert(1)>'), 'html' => '<script>do-not-expose</script>', 'url' => 'javascript:do-not-expose', 'actions' => array('do-not-expose'));
$surface['help'] = array($topic);
$surface['metrics'] = array(array('label' => 'Sources', 'value' => 3, 'help_id' => 'form-placement'));
$surface['steps'][0]['help_id'] = 'form-placement';
$surface['steps'][0]['fields'][0]['help_id'] = 'form-placement';
$surface['use_on_site'] = array('description' => 'Native placement', 'items' => array(array_replace($item, array('links' => array(), 'help_id' => 'form-placement'))));
$result = $api->read(new WP_REST_Request('test'));
surface_check(!is_wp_error($result) && $result['metrics'][0]['help_id'] === 'form-placement' && $result['steps'][0]['help_id'] === 'form-placement' && $result['steps'][0]['fields'][0]['help_id'] === 'form-placement' && $result['use_on_site']['items'][0]['help_id'] === 'form-placement', 'Contextual help references survive every supported projected location');
surface_check(array_keys($result['help'][0]) === array('id', 'title', 'summary', 'paragraphs') && !str_contains(json_encode($result), 'do-not-expose'), 'Help projection never exposes untrusted HTML, URLs or action fields');
surface_check($result['help'][0]['paragraphs'][1] === '<img src=x onerror=alert(1)>', 'Untrusted paragraph copy remains plain string data rather than executable HTML');
surface_check($result['values'] == $api->read(new WP_REST_Request('test'))['values'] && $writes === $beforeWrites && $actions === $beforeActions, 'Help projection changes no values and dispatches no mutations');
$helpedSurface = $surface;
$badTopics = array('unsupported', array($topic, $topic), array_map(static fn(int $index): array => array_replace($topic, array('id' => 'topic-' . $index)), range(0, 32)));
foreach (array(array('id' => null), array('id' => 'Invalid'), array('id' => str_repeat('x', 65)), array('title' => false), array('title' => str_repeat('x', 257)), array('summary' => null), array('summary' => str_repeat('x', 1025)), array('paragraphs' => 'unsupported'), array('paragraphs' => array(null)), array('paragraphs' => array_fill(0, 9, 'text')), array('paragraphs' => array(str_repeat('x', 4097)))) as $changes) $badTopics[] = array(array_replace($topic, $changes));
foreach ($badTopics as $badHelp) {
    $surface = array_replace($validSurface, array('help' => $badHelp));
    surface_check($api->read(new WP_REST_Request('test'))->data['status'] === 500, 'Malformed declared help fails closed without returning partial guidance');
}
$surface = $helpedSurface;
foreach (array('metrics', 'steps') as $collection) $surface[$collection][0]['help_id'] = '<script>';
$surface['steps'][0]['fields'][0]['help_id'] = array('untrusted');
$surface['use_on_site']['items'][0]['help_id'] = 'Bad';
$result = $api->read(new WP_REST_Request('test'));
surface_check(!is_wp_error($result) && !isset($result['metrics'][0]['help_id']) && !isset($result['steps'][0]['help_id']) && !isset($result['steps'][0]['fields'][0]['help_id']) && !isset($result['use_on_site']['items'][0]['help_id']), 'Malformed optional help references are omitted from the PHP projection');
$surface = $validSurface;
surface_check(!isset($api->read(new WP_REST_Request('test'))['help']), 'Older providers require no help metadata');
$surface['primary_link'] = array('label' => 'Edit in Advanced', 'url' => 'https://site.test/wp-admin/admin.php?page=configuration', 'private' => 'do-not-expose', 'action' => 'do-not-expose');
$result = $api->read(new WP_REST_Request('test'));
surface_check(($result['primary_link'] ?? null) === array('label' => 'Edit in Advanced', 'url' => 'https://site.test/wp-admin/admin.php?page=configuration') && !str_contains(json_encode($result), 'do-not-expose'), 'Primary link projection allowlists a safe destination without exposing unknown fields or actions');
foreach (array(null, false, array(), array('label' => array('bad'), 'url' => 'https://site.test/'), array('label' => 'Unsafe', 'url' => 'https://foreign.test/'), array('label' => 'Unsafe', 'url' => 'javascript:alert(1)'), array('label' => 'Unsafe', 'url' => 'https://user:pass@site.test/')) as $unsafePrimary) {
    $surface['primary_link'] = $unsafePrimary;
    $result = $api->read(new WP_REST_Request('test'));
    surface_check(!is_wp_error($result) && !isset($result['primary_link']), 'Unsafe or malformed optional primary destinations are omitted safely');
}
$surface = $validSurface;
surface_check(!isset($api->read(new WP_REST_Request('test'))['primary_link']) && $writes === $beforeWrites && $actions === $beforeActions, 'Old providers need no primary destination and link projection causes no mutation');
$descriptors = array(array_replace($descriptor, array('surface_provider' => static function () { throw new RuntimeException('do-not-expose'); })));
$result = $api->read(new WP_REST_Request('test'));
surface_check($result->data['status'] === 500 && !str_contains($result->message, 'do-not-expose'), 'Provider exception contains no internal details');
echo "Capability surface transport checks passed.\n";
