<?php
/** Disposable real WordPress/MariaDB integration; never loads a real site's settings. */
declare(strict_types=1);
$root = $argv[1] ?? '';
if (!preg_match('~^/tmp/wpsuite-backend-profiles\.[^/]+/wordpress$~D', $root)) throw new RuntimeException('Disposable fixture required');
$scenario = $argv[2] ?? '';
$_SERVER['HTTP_HOST'] = 'dev.wpsuite.io'; $_SERVER['HTTPS'] = 'on'; $_SERVER['REQUEST_METHOD'] = 'GET'; $_SERVER['REQUEST_URI'] = '/';
if ($scenario === 'install') define('WP_INSTALLING', true);
require $root . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/admin.php';
if ($scenario === 'install') {
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    wp_install('Synthetic backend profile fixture', 'profile-admin', 'profile@example.test', false, '', wp_generate_password());
    echo "Installed disposable WordPress.\n"; exit;
}
require dirname(__DIR__) . '/php/model.php';
require dirname(__DIR__) . '/php/backend-profiles.php';
use SmartCloud\WPSuite\Hub\BackendProfiles;
use SmartCloud\WPSuite\Hub\SiteSettings;
use SmartCloud\WPSuite\Hub\SiteKeyStorage;
$checks = 0;
function expect_profile(bool $value, string $message): void { global $checks; $checks++; if (!$value) throw new RuntimeException($message); }
function rejects_profile(callable $fn): void { try { $fn(); } catch (Throwable $error) { return; } throw new RuntimeException('Expected rejected stale write'); }
$current = new SiteSettings(workspaceId: 'fixture-workspace', siteId: 'fixture-site', subscriber: true, siteKey: 'synthetic-existing-key', workspaceApiMode: 'workspace', platformApiBaseUrl: 'https://api-dev.wpsuite.io', platformConfigUrl: 'https://wpsuite.io/static/config/foundation/dev/fixture.json');
SiteKeyStorage::registerFilters();
foreach (['smartcloud-wpsuite/site-settings', 'hub-for-wpsuiteio/site-settings'] as $option) update_option($option, SiteKeyStorage::encode($current), false);
BackendProfiles::boot();
BackendProfiles::setValidator(static fn() => ['jws' => 'YQ.Yg.Yw', 'config' => 'YQ:Yg']);
add_filter('pre_http_request', static function ($pre, $args, $url) {
    $prod = str_ends_with($url, '/prod.json');
    $body = ['config' => $prod ? 'prod' : 'dev', 'baseUrl' => $prod ? 'https://wpsuite.io' : 'https://dev.wpsuite.io', 'awsRegion' => 'eu-central-1', 'userPoolId' => 'eu-central-1_' . ($prod ? 'prod' : 'dev'), 'identityPoolId' => 'eu-central-1:' . ($prod ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222'), 'appClientPlugin' => 'fixtureclient'];
    if (!$prod) $body += ['workspaceApiMode' => 'workspace', 'foundationApiBaseUrl' => 'https://api-dev.wpsuite.io'];
    $body = array_replace($body, $GLOBALS['profile_bootstrap_override'] ?? []);
    return ['headers' => [], 'body' => wp_json_encode($body), 'response' => ['code' => 200, 'message' => 'OK'], 'cookies' => []];
}, 100, 3);
$status = BackendProfiles::configure(['profileId' => 'production', 'expectedGeneration' => 0, 'connection' => ['workspaceApiMode' => 'legacy', 'platformApiBaseUrl' => '', 'platformConfigUrl' => '']]);
expect_profile($status['active'] === 'development', 'First setup did not preserve the existing DEV connection');
BackendProfiles::activate(['profileId' => 'production', 'expectedGeneration' => 1]);
expect_profile(BackendProfiles::settings()->workspaceApiMode === 'legacy', 'Production profile did not activate');
expect_profile(get_option('smartcloud-wpsuite/site-settings')->workspaceApiMode === 'legacy', 'Real pre_option reader returned the original owner');
$settings = BackendProfiles::settings(); BackendProfiles::saveConnection($settings); BackendProfiles::saveConnection($settings);
expect_profile(BackendProfiles::settings()->siteKey === 'synthetic-existing-key', 'Real WordPress repeated no-op save lost its key');
$snapshot = get_option(BackendProfiles::OPTION);
$settings->useRecaptchaNet = true; BackendProfiles::saveConnection($settings);
$later = serialize(get_option(BackendProfiles::OPTION));
rejects_profile(fn() => (new ReflectionMethod(BackendProfiles::class, 'commit'))->invoke(null, 2, $snapshot));
expect_profile(serialize(get_option(BackendProfiles::OPTION)) === $later, 'Real SQL CAS reverted another write');
BackendProfiles::saveAssets(BackendProfiles::settings(), ['jws' => 'YWJj.YWJj.YWJj', 'config' => 'YWJj:YWJj']);
expect_profile(get_option(BackendProfiles::optionName('smartcloud-wpsuiteio/license-jws')) === 'YWJj.YWJj.YWJj', 'Scoped real cache alias is not atomic');
BackendProfiles::runWithContext(BackendProfiles::legacyContext(), function (): void {
    expect_profile(BackendProfiles::settings()->workspaceApiMode === 'workspace', 'Captured DEV context resolved active PROD settings');
    expect_profile(BackendProfiles::optionName('smartcloud-flow') === 'smartcloud-flow', 'Original owner options moved');
});
require dirname(__DIR__, 3) . '/flow/admin/php/backend-profile-state.php';
require dirname(__DIR__, 3) . '/flow/admin/php/form-sync-meta.php';
$postId = wp_insert_post(['post_title' => 'Synthetic shared CMS content', 'post_status' => 'draft']);
expect_profile(is_int($postId) && $postId > 0, 'Fixture post creation failed');
$key = \SmartCloud\WPSuite\Flow\BackendProfileState::metaKey('workflows_backend_form_id');
update_post_meta($postId, $key, 'production-form');
expect_profile(\SmartCloud\WPSuite\Flow\FormSyncMeta::getFormId($postId) === 'production-form', 'Production form metadata missing');
BackendProfiles::activate(['profileId' => 'development', 'expectedGeneration' => 2]);
expect_profile(\SmartCloud\WPSuite\Flow\FormSyncMeta::getFormId($postId) === null, 'DEV incorrectly inherited production Synced form');
update_post_meta($postId, \SmartCloud\WPSuite\Flow\BackendProfileState::metaKey('workflows_backend_form_id'), 'dev-form');
expect_profile(\SmartCloud\WPSuite\Flow\FormSyncMeta::getFormId($postId) === 'dev-form', 'DEV form did not resolve its own state');
BackendProfiles::activate(['profileId' => 'production', 'expectedGeneration' => 3]);
expect_profile(\SmartCloud\WPSuite\Flow\FormSyncMeta::getFormId($postId) === 'production-form', 'Returning to production lost its form binding');
expect_profile(get_post($postId)->post_title === 'Synthetic shared CMS content', 'Profile switch changed shared content');
$beforeMalformed = get_option(BackendProfiles::OPTION);
$GLOBALS['profile_bootstrap_override'] = ['identityPoolId' => 'eu-central-1:bad'];
rejects_profile(fn() => BackendProfiles::activate(['profileId' => 'production', 'expectedGeneration' => BackendProfiles::status()['generation']]));
unset($GLOBALS['profile_bootstrap_override']);
expect_profile(serialize(get_option(BackendProfiles::OPTION)) === serialize($beforeMalformed), 'Malformed downloaded identity changed the real registry/cache');
$GLOBALS['profile_bootstrap_override'] = ['userPoolId' => 'eu-central-1_NewValidPool'];
rejects_profile(fn() => BackendProfiles::activate(['profileId' => 'production', 'expectedGeneration' => BackendProfiles::status()['generation']]));
rejects_profile(fn() => BackendProfiles::configure(['profileId' => 'production', 'expectedGeneration' => BackendProfiles::status()['generation'], 'connection' => []]));
unset($GLOBALS['profile_bootstrap_override']);
expect_profile(serialize(get_option(BackendProfiles::OPTION)) === serialize($beforeMalformed), 'Valid changed identity silently retargeted the saved binding or cache');
$badRegistry = $beforeMalformed; $badRegistry['profiles']['development']['identity']['userPoolId'] = 'eu-central-1_';
update_option(BackendProfiles::OPTION, $badRegistry, false);
rejects_profile(fn() => BackendProfiles::settings());
update_option(BackendProfiles::OPTION, $beforeMalformed, false);
expect_profile(BackendProfiles::captureContext()['id'] === 'production', 'Restored valid real registry failed after rejecting malformed saved identity');
echo 'Real WordPress/MariaDB profile integration PASS: ' . $checks . " checks.\n";
