<?php
declare(strict_types=1);
use SmartCloud\WPSuite\Hub\BackendProfiles;
use SmartCloud\WPSuite\Hub\SiteSettings;
use SmartCloud\WPSuite\Hub\SiteKeyStorage;
define('ABSPATH', __DIR__ . '/');
define('DAY_IN_SECONDS', 86400);
require __DIR__ . '/site-key-storage-fixture.php';
$GLOBALS['options'] = []; $GLOBALS['filters'] = []; $GLOBALS['host'] = 'https://dev.wpsuite.io'; $GLOBALS['cap'] = true;
function home_url(string $path = ''): string { return $GLOBALS['host'] . $path; }
function site_url(): string { return $GLOBALS['host']; }
function add_filter($hook, $fn, $priority = 10, $args = 1): void { $GLOBALS['filters'][$hook][$priority][] = $fn; }
function add_action($hook, $fn, $priority = 10, $args = 1): void { add_filter($hook, $fn, $priority, $args); }
function apply_filters($hook, $value, ...$args): mixed { $groups = $GLOBALS['filters'][$hook] ?? []; ksort($groups); foreach ($groups as $callbacks) foreach ($callbacks as $fn) $value = $fn($value, ...$args); return $value; }
function get_option($name, $default = false): mixed { $pre = apply_filters('pre_option_' . $name, false); if ($pre !== false) return $pre; return apply_filters('option_' . $name, $GLOBALS['options'][$name] ?? $default); }
function update_option($name, $value, $autoload = false): bool { if (($GLOBALS['fail_option'] ?? null) === $name || serialize($GLOBALS['options'][$name] ?? null) === serialize($value)) return false; $GLOBALS['options'][$name] = $value; return true; }
function delete_option($name): bool { unset($GLOBALS['options'][$name]); return true; }
function wp_cache_delete($key, $group): void {}
function current_user_can($cap): bool { return $GLOBALS['cap']; }
function wp_verify_nonce($value, $action): bool { return $value === 'synthetic-nonce'; }
function wp_salt($type): string { return 'synthetic-render-signing-material-only'; }
function is_wp_error($value): bool { return $value instanceof WP_Error; }
function wp_remote_get($url, $args): array {
    if ($GLOBALS['bootstrap_failed'] ?? false) return ['status' => 404, 'body' => '{}'];
    $production = str_ends_with($url, '/prod.json');
    $data = ['config' => $production ? 'prod' : 'dev', 'baseUrl' => $production ? 'https://wpsuite.io' : 'https://dev.wpsuite.io',
        'awsRegion' => 'eu-central-1', 'userPoolId' => 'eu-central-1_' . ($production ? 'prod' : 'dev'), 'identityPoolId' => 'eu-central-1:' . ($production ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222'), 'appClientPlugin' => 'syntheticclient'];
    if (!$production) $data += ['workspaceApiMode' => 'workspace', 'foundationApiBaseUrl' => 'https://api-dev.wpsuite.io'];
    if ($GLOBALS['bootstrap_wrong_identity'] ?? false) $data['baseUrl'] = 'https://dev.wpsuite.io';
    $data = array_replace($data, $GLOBALS['bootstrap_overrides'] ?? []);
    return ['status' => 200, 'body' => json_encode($data)];
}
function wp_remote_retrieve_response_code($response): int { return $response['status']; }
function wp_remote_retrieve_body($response): string { return $response['body']; }
function wp_die($message, $title = '', $args = []): never { throw new RuntimeException('WP_DIE'); }
class WP_Error { public function __construct(public $code, public $message, public $data) {} }
class Request {
    public function __construct(public array $headers = [], public string $method = 'POST', public string $route = '/smartcloud-flow/v1/forms/1/sync-meta') {}
    public function get_header($key): string { return $this->headers[$key] ?? ''; }
    public function get_method(): string { return $this->method; }
    public function get_route(): string { return $this->route; }
}
class Database {
    public string $options = 'synthetic_options'; public bool $busy = false;
    public function prepare($sql, ...$args): string { return $sql; }
    public function get_var($sql): string { return $this->busy && str_contains($sql, 'GET_LOCK') ? '0' : '1'; }
}
$wpdb = new Database();
require dirname(__DIR__) . '/php/model.php';
require dirname(__DIR__) . '/php/backend-profiles.php';
function check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function reject(callable $fn, string $message): void { try { $fn(); } catch (Throwable $error) { return; } throw new RuntimeException($message); }
SiteKeyStorage::registerFilters();
$dev = new SiteSettings(workspaceId: 'synthetic-workspace', siteId: 'synthetic-site', subscriber: true, siteKey: 'synthetic-site-key', workspaceApiMode: 'workspace', platformApiBaseUrl: 'https://api-dev.wpsuite.io', platformConfigUrl: 'https://wpsuite.io/static/config/foundation/dev/test.json');
$sealed = SiteKeyStorage::encode($dev);
foreach (['smartcloud-wpsuite/site-settings', 'hub-for-wpsuiteio/site-settings'] as $name) $GLOBALS['options'][$name] = clone $sealed;
$GLOBALS['options']['smartcloud-wpsuiteio/license-jws'] = 'old-dev-license';
$GLOBALS['host'] = 'https://demo.wpsuite.io';
check(!BackendProfiles::eligible(), 'Non-dev host accepted');
reject(fn() => BackendProfiles::configure([]), 'Non-dev mutation accepted');
check(BackendProfiles::captureContext() === null && BackendProfiles::optionName('x') === 'x', 'Non-dev state changed');
$GLOBALS['host'] = 'https://dev.wpsuite.io';
BackendProfiles::boot();
check(BackendProfiles::status()['active'] === 'production' && !BackendProfiles::enabled(), 'Initial default is not unconfigured production');
$calls = [];
BackendProfiles::setValidator(function ($settings) use (&$calls) {
    $calls[] = BackendProfiles::legacyApiBase('wrong');
    return ['jws' => 'YQ.Yg.Yw', 'config' => 'YQ:Yg'];
});
$before = serialize([$GLOBALS['options']['smartcloud-wpsuite/site-settings'], $GLOBALS['options']['hub-for-wpsuiteio/site-settings']]);
$initializationContexts = [];
add_filter('smartcloud_wpsuite_backend_profile_initialization_check', static function ($ready, $context) use (&$initializationContexts) { $initializationContexts[] = $context; return !($GLOBALS['legacy_exporter_busy'] ?? false); }, 10, 2);
$GLOBALS['legacy_exporter_busy'] = true;
$beforeBlockedInitialization = serialize($GLOBALS['options']);
reject(fn() => BackendProfiles::configure(['profileId' => 'production', 'expectedGeneration' => 0, 'connection' => ['workspaceApiMode' => 'legacy', 'platformApiBaseUrl' => '', 'platformConfigUrl' => '']]), 'Busy legacy exporter did not block initial setup');
check(serialize($GLOBALS['options']) === $beforeBlockedInitialization, 'Blocked initial setup changed live state');
$GLOBALS['legacy_exporter_busy'] = false;
$calls = [];
$status = BackendProfiles::configure(['profileId' => 'production', 'expectedGeneration' => 0, 'connection' => ['workspaceApiMode' => 'legacy', 'platformApiBaseUrl' => '', 'platformConfigUrl' => '']]);
check($initializationContexts === [['id' => 'development', 'bindingRevision' => 1], ['id' => 'development', 'bindingRevision' => 1]], 'Initialization guard lost the legacy owner');
check($status['active'] === 'development' && $status['generation'] === 1, 'Initial setup silently switched the working DEV connection');
check($calls === ['https://api.wpsuite.io'], 'Production validation used dev hostname fallback');
check($before === serialize([$GLOBALS['options']['smartcloud-wpsuite/site-settings'], $GLOBALS['options']['hub-for-wpsuiteio/site-settings']]), 'Original sealed mirrors changed');
check($GLOBALS['options']['smartcloud-wpsuiteio/license-jws'] === 'old-dev-license', 'Production cache overwrote original dev cache');
check($GLOBALS['options'][BackendProfiles::OPTION]['profiles']['production']['assets']['jws'] === 'YQ.Yg.Yw', 'Production cache missing');
check(!str_contains(serialize($GLOBALS['options'][BackendProfiles::OPTION]), 'synthetic-site-key'), 'Profile stored plaintext key');
check(!str_contains(json_encode($status), 'wpsuite-key:'), 'Status leaked sealed key');
$status = BackendProfiles::activate(['profileId' => 'production', 'expectedGeneration' => 1]);
check($status['active'] === 'production' && $status['generation'] === 2, 'Explicit activation failed');
check(count($initializationContexts) === 2, 'Ordinary activation reran the initialization side effect');
check(get_option('smartcloud-wpsuite/site-settings')->workspaceApiMode === 'legacy', 'Canonical reader did not resolve production profile');
check(BackendProfiles::optionName('smartcloud-flow') === 'wpsuite-profile/production/smartcloud-flow', 'Production options not isolated');
$context = BackendProfiles::captureContext();
check($context['legacyConfigUrl'] === 'https://wpsuite.io/static/config/prod.json', 'Production bootstrap points at dev config');
check(BackendProfiles::legacyContext() === ['id' => 'development', 'bindingRevision' => 1], 'Legacy jobs changed ownership');
BackendProfiles::runWithContext(BackendProfiles::legacyContext(), function (): void {
    check(BackendProfiles::captureContext()['id'] === 'development', 'Pinned job lost profile');
    check(BackendProfiles::optionName('smartcloud-flow') === 'smartcloud-flow', 'Original owner state moved');
    check(get_option('smartcloud-wpsuite/site-settings')->workspaceApiMode === 'workspace', 'Pinned reader used active production connection');
});
check(BackendProfiles::captureContext()['id'] === 'production', 'Pinned job leaked request override');
check(BackendProfiles::saveConnection(BackendProfiles::settings()), 'Real WordPress no-op settings save failed');
$staleSnapshot = $GLOBALS['options'][BackendProfiles::OPTION];
$changed = clone BackendProfiles::settings(); $changed->reCaptchaPublicKey = 'public-synthetic-change';
BackendProfiles::saveConnection($changed);
$afterConcurrentSave = serialize($GLOBALS['options']);
$commit = new ReflectionMethod(BackendProfiles::class, 'commit');
reject(fn() => $commit->invoke(null, 2, $staleSnapshot), 'Same-generation stale snapshot overwrote another profile write');
check(serialize($GLOBALS['options']) === $afterConcurrentSave, 'Storage CAS did not preserve the concurrent update');
reject(fn() => BackendProfiles::runWithContext(['id' => 'development', 'bindingRevision' => 7], fn() => true), 'Unknown binding revision accepted');
$snapshot = serialize($GLOBALS['options']);
foreach (['bootstrap_failed', 'bootstrap_wrong_identity'] as $fault) {
    $GLOBALS[$fault] = true;
    reject(fn() => BackendProfiles::activate(['profileId' => 'production', 'expectedGeneration' => 2]), 'Invalid public bootstrap accepted');
    unset($GLOBALS[$fault]);
    check(serialize($GLOBALS['options']) === $snapshot, 'Bootstrap validation failure changed state');
}
$invalidIdentityFields = [
    ['userPoolId' => 'eu-central-1_'], ['userPoolId' => 'eu-central-1_has/slash'], ['userPoolId' => 'us-east-1_Foreign'],
    ['userPoolId' => ['invalid']], ['identityPoolId' => 'eu-central-1:bad'],
    ['identityPoolId' => 'us-east-1:11111111-1111-4111-8111-111111111111'], ['identityPoolId' => null],
    ['appClientPlugin' => ''], ['appClientPlugin' => ['invalid']], ['appClientPlugin' => str_repeat('a', 129)],
    ['appClient' => null], ['appClient' => ['invalid']], ['appClient' => 'contains space'],
];
foreach ($invalidIdentityFields as $fields) {
    $GLOBALS['bootstrap_overrides'] = $fields;
    reject(fn() => BackendProfiles::activate(['profileId' => 'production', 'expectedGeneration' => 2]), 'Malformed Cognito bootstrap was activated');
    check(serialize($GLOBALS['options']) === $snapshot, 'Malformed identity bootstrap changed active selection or cache');
}
unset($GLOBALS['bootstrap_overrides']);
foreach ([['userPoolId' => 'eu-central-1_ChangedValidPool'], ['identityPoolId' => 'eu-central-1:33333333-3333-4333-8333-333333333333'], ['appClientPlugin' => 'changedvalidclient'], ['appClient' => 'newfrontendclient']] as $fields) {
    $GLOBALS['bootstrap_overrides'] = $fields;
    foreach ([fn() => BackendProfiles::activate(['profileId' => 'production', 'expectedGeneration' => 2]),
        fn() => BackendProfiles::configure(['profileId' => 'production', 'expectedGeneration' => 2, 'connection' => []])] as $operation) {
        $reason = ''; $validationCallsBefore = count($calls);
        try { $operation(); } catch (RuntimeException $error) { $reason = $error->getMessage(); }
        check($reason === 'PROFILE_REBIND_REQUIRES_MIGRATION', 'Valid changed bootstrap identity did not require explicit migration');
        check(count($calls) === $validationCallsBefore, 'Changed identity reached license/key-retention validator before rejection');
        check(serialize($GLOBALS['options']) === $snapshot, 'Changed identity activation/configure wrote profile state or cache');
    }
}
unset($GLOBALS['bootstrap_overrides']);
$goodRegistry = $GLOBALS['options'][BackendProfiles::OPTION];
foreach ($invalidIdentityFields as $fields) {
    $GLOBALS['options'][BackendProfiles::OPTION]['profiles']['production']['identity'] = array_replace($goodRegistry['profiles']['production']['identity'], $fields);
    reject(fn() => BackendProfiles::captureContext(), 'Malformed stored Cognito identity silently fell back');
    $GLOBALS['options'][BackendProfiles::OPTION] = $goodRegistry;
}
unset($GLOBALS['options'][BackendProfiles::OPTION]['profiles']['production']['identity']);
reject(fn() => BackendProfiles::settings(), 'Missing stored identity silently fell back');
$GLOBALS['options'][BackendProfiles::OPTION] = $goodRegistry;
$GLOBALS['fail_option'] = BackendProfiles::OPTION;
reject(fn() => BackendProfiles::activate(['profileId' => 'development', 'expectedGeneration' => 2]), 'Registry write failure accepted');
unset($GLOBALS['fail_option']);
check(serialize($GLOBALS['options']) === $snapshot, 'Failed atomic registry/cache write changed live state');
foreach ([['generation', 'invalid'], ['active', 'missing']] as [$key, $value]) {
    $good = $GLOBALS['options'][BackendProfiles::OPTION];
    $GLOBALS['options'][BackendProfiles::OPTION][$key] = $value;
    reject(fn() => BackendProfiles::captureContext(), 'Corrupted profile state silently fell back');
    $GLOBALS['options'][BackendProfiles::OPTION] = $good;
}
reject(fn() => BackendProfiles::activate(['profileId' => 'development', 'expectedGeneration' => 1]), 'Stale activation accepted');
check(serialize($GLOBALS['options']) === $snapshot, 'Stale activation wrote data');
reject(fn() => BackendProfiles::configure(['profileId' => 'production', 'expectedGeneration' => 2, 'connection' => ['siteId' => 'foreign']]), 'Foreign identity reused current key');
reject(fn() => BackendProfiles::configure(['profileId' => 'production', 'expectedGeneration' => 2, 'connection' => ['siteKey' => 'synthetic-replacement-key']]), 'Rebinding reused old async state');
$headers = ['X-WPSuite-Backend-Profile' => 'production', 'X-WPSuite-Backend-Generation' => '2', 'X-WPSuite-Backend-Binding-Revision' => '1'];
check(BackendProfiles::guardRequest(null, null, new Request($headers)) === null, 'Matching profile blocked');
check(BackendProfiles::guardRequest(null, null, new Request()) instanceof WP_Error, 'Unbound mutation accepted');
check(BackendProfiles::guardRequest(null, null, new Request($headers, 'GET')) === null, 'Read unnecessarily blocked');
$permission = new Request(['X-WP-Nonce' => 'wrong']); check(BackendProfiles::permission($permission) instanceof WP_Error, 'Invalid nonce accepted');
$GLOBALS['cap'] = false; check(BackendProfiles::permission(new Request(['X-WP-Nonce' => 'synthetic-nonce'])) instanceof WP_Error, 'Non-admin accepted'); $GLOBALS['cap'] = true;
$token = BackendProfiles::renderHeaders(BackendProfiles::legacyContext());
check(!BackendProfiles::verifiedRenderContext(), 'A generated token alone authenticated the request');
check(isset($token['X-WPSuite-Render-Context']) && !str_contains($token['X-WPSuite-Render-Context'], 'synthetic-site-key'), 'Invalid render capability');
$reader = new ReflectionMethod(BackendProfiles::class, 'readRenderContext');
$_SERVER['HTTP_X_WPSUITE_RENDER_CONTEXT'] = $token['X-WPSuite-Render-Context']; $_SERVER['REQUEST_METHOD'] = 'GET';
$reader->invoke(null); check(BackendProfiles::captureContext()['id'] === 'development', 'Render did not pin queued dev job');
check(BackendProfiles::verifiedRenderContext(), 'Validated render context was not marked trusted');
$override = new ReflectionProperty(BackendProfiles::class, 'override'); $override->setValue(null, null);
check(!BackendProfiles::verifiedRenderContext(), 'Render verification leaked to another selected profile');
$_SERVER['HTTP_X_WPSUITE_RENDER_CONTEXT'][0] = 'Z'; reject(fn() => $reader->invoke(null), 'Tampered render capability accepted');
check(!BackendProfiles::verifiedRenderContext(), 'Tampered header retained a trusted render marker');
$_SERVER['HTTP_X_WPSUITE_RENDER_CONTEXT'] = $token['X-WPSuite-Render-Context']; $_SERVER['REQUEST_METHOD'] = 'POST'; $_SERVER['REQUEST_URI'] = '/wp-json/wp/v2/posts';
reject(fn() => $reader->invoke(null), 'Render capability authorized content writes');
$_SERVER['REQUEST_URI'] = '/wp-json/smartcloud-static-publisher/v1/content-sync/head'; $reader->invoke(null);
check(BackendProfiles::guardRequest(null, null, new Request([], 'POST', '/smartcloud-static-publisher/v1/content-sync/head')) === null, 'Pinned publisher callback did not reach its own runtime-token permission');
$override->setValue(null, null); unset($_SERVER['HTTP_X_WPSUITE_RENDER_CONTEXT']);
$wpdb->busy = true; reject(fn() => BackendProfiles::activate(['profileId' => 'development', 'expectedGeneration' => 2]), 'Concurrent profile operation accepted'); $wpdb->busy = false;
BackendProfiles::activate(['profileId' => 'development', 'expectedGeneration' => 2]);
check(BackendProfiles::captureContext()['id'] === 'development' && BackendProfiles::captureContext()['namespace'] === '', 'Return to original profile lost state');
$snapshot = serialize($GLOBALS['options']);
BackendProfiles::setValidator(static fn() => null);
reject(fn() => BackendProfiles::activate(['profileId' => 'production', 'expectedGeneration' => 3]), 'Failed target validation switched active profile');
check(serialize($GLOBALS['options']) === $snapshot, 'Failed validation mutated state');
echo "Backend profiles: host/nonce/capability, sealed tuples, default preservation, scoped cache, CAS, pinned jobs/render, stale mutations, rebind prevention and failure preservation PASS.\n";

// Production preview: require the matching API, trusted public origin and exact identity.
$previewFixtureOptions = unserialize(serialize($GLOBALS['options']));
$previewFixtureContext = (new ReflectionProperty(BackendProfiles::class, 'requestContext'))->getValue();
$previewFixtureValidator = (new ReflectionProperty(BackendProfiles::class, 'validator'))->getValue();
$bootstrap = new ReflectionMethod(BackendProfiles::class, 'validateBootstrap');
$preview = new SiteSettings(workspaceId: 'synthetic-workspace', siteId: 'synthetic-site', subscriber: true, siteKey: 'synthetic-site-key', workspaceApiMode: 'workspace', platformApiBaseUrl: 'https://api-prod.wpsuite.io', platformConfigUrl: 'https://prod.wpsuite.io/static/config/foundation/releases/prod/test.json');
$GLOBALS['bootstrap_overrides'] = ['config' => 'prod', 'baseUrl' => 'https://prod.wpsuite.io', 'workspaceApiMode' => 'workspace', 'foundationApiBaseUrl' => 'https://api-prod.wpsuite.io', 'userPoolId' => 'eu-central-1_previewprod', 'identityPoolId' => 'eu-central-1:33333333-3333-4333-8333-333333333333'];
check($bootstrap->invoke(null, ['id' => 'production'], $preview)['baseUrl'] === 'https://prod.wpsuite.io', 'Preview bootstrap rejected matching production binding');
$stableProd = clone $preview; $stableProd->platformConfigUrl = 'https://prod.wpsuite.io/static/config/foundation/prod/config.json';
check($bootstrap->invoke(null, ['id' => 'production'], $stableProd)['baseUrl'] === 'https://prod.wpsuite.io', 'Stable production bootstrap rejected');
foreach (['https://prod.wpsuite.io/static/config/foundation/dev/config.json', 'https://prod.wpsuite.io/static/config/foundation/prod/config.json?x=1', 'https://prod.wpsuite.io/static/config/foundation/prod/other.json'] as $url) {
    $invalid = clone $preview; $invalid->platformConfigUrl = $url;
    reject(fn() => $bootstrap->invoke(null, ['id' => 'production'], $invalid), 'Invalid stable production URL accepted');
}
$stableDev = clone $preview; $stableDev->platformApiBaseUrl = 'https://api-dev.wpsuite.io'; $stableDev->platformConfigUrl = 'https://prod.wpsuite.io/static/config/foundation/dev/config.json';
$GLOBALS['bootstrap_overrides'] = ['config' => 'dev', 'baseUrl' => 'https://dev.wpsuite.io', 'workspaceApiMode' => 'workspace', 'foundationApiBaseUrl' => 'https://api-dev.wpsuite.io', 'userPoolId' => 'eu-central-1_previewdev', 'identityPoolId' => 'eu-central-1:33333333-3333-4333-8333-333333333333'];
check($bootstrap->invoke(null, ['id' => 'development'], $stableDev)['baseUrl'] === 'https://dev.wpsuite.io', 'Stable development bootstrap rejected');
foreach (['https://prod.wpsuite.io/static/config/foundation/prod/config.json', 'https://prod.wpsuite.io/static/config/foundation/dev/config.json#x', 'https://prod.wpsuite.io/static/config/foundation/releases/dev/test.json'] as $url) {
    $invalid = clone $stableDev; $invalid->platformConfigUrl = $url;
    reject(fn() => $bootstrap->invoke(null, ['id' => 'development'], $invalid), 'Invalid stable development URL accepted');
}
$invalid = clone $stableDev; $invalid->platformApiBaseUrl = 'https://api-prod.wpsuite.io';
reject(fn() => $bootstrap->invoke(null, ['id' => 'development'], $invalid), 'Stable development URL accepted wrong API');
$GLOBALS['bootstrap_overrides'] = ['config' => 'prod', 'baseUrl' => 'https://prod.wpsuite.io', 'workspaceApiMode' => 'workspace', 'foundationApiBaseUrl' => 'https://api-prod.wpsuite.io', 'userPoolId' => 'eu-central-1_previewprod', 'identityPoolId' => 'eu-central-1:33333333-3333-4333-8333-333333333333'];
foreach (['https://prod.wpsuite.io.evil.test/static/config/foundation/releases/prod/test.json', 'https://prod.wpsuite.io/static/config/foundation/releases/prod/../test.json', 'https://prod.wpsuite.io/static/config/foundation/releases/dev/test.json', 'https://prod.wpsuite.io/static/config/foundation/releases/prod/test.json?x=1', 'https://wpsuite.io/static/config/prod.json', 'http://prod.wpsuite.io/static/config/foundation/releases/prod/test.json'] as $url) {
    $invalid = clone $preview; $invalid->platformConfigUrl = $url;
    reject(fn() => $bootstrap->invoke(null, ['id' => 'production'], $invalid), 'Untrusted preview configuration accepted');
}
$GLOBALS['bootstrap_overrides']['foundationApiBaseUrl'] = 'https://api-dev.wpsuite.io';
reject(fn() => $bootstrap->invoke(null, ['id' => 'production'], $preview), 'Preview accepted DEV API identity');
$GLOBALS['bootstrap_overrides']['foundationApiBaseUrl'] = 'https://api-prod.wpsuite.io';
$old = $GLOBALS['options'][BackendProfiles::OPTION];
$oldScopedOption = 'wpsuite-profile/production/gatey';
$GLOBALS['options'][$oldScopedOption] = ['sentinel' => 'keep-old-local-settings'];
$devBefore = serialize($old['profiles']['development']);
BackendProfiles::setValidator(static function () { check(BackendProfiles::validatingConnection(), 'Profile validation flag missing'); return ['jws' => 'ZA.ZQ.Zg', 'config' => 'ZA:ZQ']; });
$fields = ['workspaceApiMode' => 'workspace', 'platformApiBaseUrl' => $preview->platformApiBaseUrl, 'platformConfigUrl' => $preview->platformConfigUrl];
$request = ['profileId' => 'production', 'expectedGeneration' => 3, 'connection' => $fields];
reject(fn() => BackendProfiles::configure($request), 'Legacy rebind accepted without explicit archival');
foreach (['workspaceId' => 'foreign-workspace', 'siteId' => 'foreign-site', 'siteKey' => 'different-synthetic-key'] as $field => $value) {
    reject(fn() => BackendProfiles::configure(array_replace($request, ['archiveLegacyProduction' => true, 'connection' => array_replace($fields, [$field => $value])])), 'Archive transition allowed a changed site/key');
}
$status = BackendProfiles::configure($request + ['archiveLegacyProduction' => true]);
$next = $GLOBALS['options'][BackendProfiles::OPTION];
check($status['active'] === 'development' && $status['generation'] === 4, 'Archive transition changed active backend');
$bootFlag = new ReflectionProperty(BackendProfiles::class, 'booted'); $bootFlag->setValue(null, false); BackendProfiles::boot();
check(get_option('wpsuite-profile/production/smartcloud-wpsuiteio/license-jws') === $old['profiles']['production']['assets']['jws'], 'Historical licence alias points at replacement binding');
check(get_option('wpsuite-profile/production/bindings/2/smartcloud-wpsuiteio/license-jws') === 'ZA.ZQ.Zg', 'Replacement licence alias missing');
check(!BackendProfiles::validatingConnection(), 'Validation flag leaked after commit');
check($next['profiles']['production']['bindingRevision'] === 2 && $next['profiles']['production']['stateNamespace'] === 'production/bindings/2', 'New production binding reused its old settings namespace');
check(serialize($next['archivedProfiles']['production'][1]) === serialize($old['profiles']['production']), 'Legacy sealed binding/assets were not preserved');
check(serialize($next['profiles']['development']) === $devBefore && $GLOBALS['options'][$oldScopedOption]['sentinel'] === 'keep-old-local-settings', 'Transition changed DEV or historical options');
reject(fn() => BackendProfiles::runWithContext(['id' => 'production', 'bindingRevision' => 1], fn() => true), 'Old captured production job was retargeted');
BackendProfiles::runWithContext(['id' => 'production', 'bindingRevision' => 2], static function (): void {
    check(BackendProfiles::optionName('gatey') === 'wpsuite-profile/production/bindings/2/gatey', 'New binding leaked old Gatey settings');
    check(get_option(BackendProfiles::optionName('gatey'), null) === null, 'New binding inherited historical local state');
    check(BackendProfiles::settings()->platformApiBaseUrl === 'https://api-prod.wpsuite.io', 'New binding lost selected preview API');
});
reject(fn() => BackendProfiles::configure(['profileId' => 'production', 'expectedGeneration' => 4, 'archiveLegacyProduction' => true, 'connection' => $fields]), 'Foundation binding could be archived/replaced repeatedly');
unset($GLOBALS['bootstrap_overrides']);
echo "Production preview exact pairing, archival revision, stale jobs and namespace isolation PASS.\n";

// Other component fixtures include this suite: leave its established baseline exact.
$GLOBALS['options'] = $previewFixtureOptions;
(new ReflectionProperty(BackendProfiles::class, 'requestContext'))->setValue(null, $previewFixtureContext);
(new ReflectionProperty(BackendProfiles::class, 'validator'))->setValue(null, $previewFixtureValidator);
