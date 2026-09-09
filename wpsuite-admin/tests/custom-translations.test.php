<?php

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');

$GLOBALS['wpsuite_test_options'] = array();
$GLOBALS['wpsuite_test_autoload'] = array();
$GLOBALS['wpsuite_test_updates'] = array();
$GLOBALS['wpsuite_test_can_manage'] = true;

class WP_Error
{
    public function __construct(
        private string $code,
        private string $message,
        private mixed $data = null
    ) {
    }

    public function get_error_code(): string
    {
        return $this->code;
    }

    public function get_error_data(): mixed
    {
        return $this->data;
    }
}

class WP_REST_Request
{
    /** @param array<string, string> $headers */
    public function __construct(private string $body = '', private array $headers = array())
    {
    }

    public function get_body(): string
    {
        return $this->body;
    }

    public function get_header(string $name): string
    {
        foreach ($this->headers as $header => $value) {
            if (strcasecmp($header, $name) === 0) {
                return $value;
            }
        }
        return '';
    }
}

class WP_REST_Response
{
    /** @var array<string, string> */
    public array $headers = array();

    public function __construct(public mixed $data = null, public int $status = 200)
    {
    }

    public function header(string $name, string $value): void
    {
        $this->headers[$name] = $value;
    }
}

function __(string $message, string $domain = 'default'): string
{
    unset($domain);
    return $message;
}

function current_user_can(string $capability): bool
{
    return $capability === 'manage_options' && $GLOBALS['wpsuite_test_can_manage'];
}

function get_option(string $key, mixed $default = false): mixed
{
    return array_key_exists($key, $GLOBALS['wpsuite_test_options'])
        ? $GLOBALS['wpsuite_test_options'][$key]
        : $default;
}

function add_option(string $key, mixed $value, string $deprecated = '', mixed $autoload = 'yes'): bool
{
    unset($deprecated);
    if (array_key_exists($key, $GLOBALS['wpsuite_test_options'])) {
        return false;
    }
    $GLOBALS['wpsuite_test_options'][$key] = $value;
    $GLOBALS['wpsuite_test_autoload'][$key] = $autoload;
    return true;
}

function update_option(string $key, mixed $value, mixed $autoload = null): bool
{
    $changed = !array_key_exists($key, $GLOBALS['wpsuite_test_options'])
        || $GLOBALS['wpsuite_test_options'][$key] !== $value;
    $GLOBALS['wpsuite_test_options'][$key] = $value;
    $GLOBALS['wpsuite_test_autoload'][$key] = $autoload;
    $GLOBALS['wpsuite_test_updates'][] = $key;
    return $changed;
}

function delete_option(string $key): bool
{
    if (!array_key_exists($key, $GLOBALS['wpsuite_test_options'])) {
        return false;
    }
    unset($GLOBALS['wpsuite_test_options'][$key], $GLOBALS['wpsuite_test_autoload'][$key]);
    return true;
}

function wp_json_encode(mixed $value, int $flags = 0): string|false
{
    return json_encode($value, $flags);
}

function is_wp_error(mixed $value): bool
{
    return $value instanceof WP_Error;
}

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

function expect_error(mixed $result, string $code, int $status): void
{
    expect($result instanceof WP_Error, 'Expected WP_Error: ' . $code);
    expect($result->get_error_code() === $code, 'Unexpected WP_Error code.');
    expect(($result->get_error_data()['status'] ?? null) === $status, 'Unexpected WP_Error status.');
}

require_once dirname(__DIR__) . '/php/custom-translations.php';

use SmartCloud\WPSuite\Hub\CustomTranslationsCatalog;
use const SmartCloud\WPSuite\Hub\WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION;
use const SmartCloud\WPSuite\Hub\WPSUITE_CUSTOM_TRANSLATIONS_LOCK;
use const SmartCloud\WPSuite\Hub\WPSUITE_CUSTOM_TRANSLATIONS_MAX_BYTES;
use const SmartCloud\WPSuite\Hub\WPSUITE_CUSTOM_TRANSLATIONS_OPTION;

$store = new CustomTranslationsCatalog(
    static fn(string $revision): string => 'https://site.test/smartcloud-wpsuiteio/custom-translations.json?ver=' . $revision
);

$empty = $store->getState();
expect($empty['catalog'] === array(), 'A missing option must produce an empty catalog.');
expect($empty['defaultLocale'] === null, 'A missing option must not have a default locale.');
expect($empty['json'] === '{}', 'The empty catalog must use canonical object JSON.');
expect(
    $empty['revision'] === hash('sha256', '{"catalog":{},"defaultLocale":null}'),
    'The empty catalog revision must include the default locale state.'
);
expect(str_ends_with($store->getAssetUrl(), $empty['revision']), 'The asset URL must contain the full revision.');

$get = $store->getRestResponse(new WP_REST_Request());
expect($get->status === 200, 'GET must return success.');
expect($get->data['catalog'] instanceof stdClass, 'GET must return the empty catalog as a JSON object.');
expect(get_object_vars($get->data['catalog']) === array(), 'GET must return the empty catalog.');
expect($get->data['defaultLocale'] === null, 'GET must expose the empty default locale.');
expect($get->data['assetUrl'] === $store->getAssetUrl(), 'GET must return the server-resolved asset URL.');
expect(($get->headers['ETag'] ?? '') === '"' . $empty['revision'] . '"', 'GET must return a strong ETag.');

$missing_precondition = $store->putRestResponse(
    new WP_REST_Request('{"catalog":{},"defaultLocale":null}')
);
expect_error($missing_precondition, 'wpsuite_translations_precondition_required', 428);

$weak_precondition = $store->putRestResponse(
    new WP_REST_Request('{"catalog":{},"defaultLocale":null}', array('If-Match' => 'W/"' . $empty['revision'] . '"'))
);
expect_error($weak_precondition, 'wpsuite_translations_revision_conflict', 412);

$invalid_payloads = array(
    '[]',
    '{"catalog":[]}',
    '{"catalog":{},"defaultLocale":"en-US"}',
    '{"catalog":{"en-US":{}},"defaultLocale":null}',
    '{"catalog":{"en-US":{}},"defaultLocale":"hu-HU"}',
    '{"catalog":{"en-US":{}},"defaultLocale":12}',
    '{"catalog":{"english":{"Hello":"Hi"}}}',
    '{"catalog":{"en":{"Hello":12}}}',
    '{"catalog":{"en":["Hi"]}}',
    '{"catalog":{"en-US":{},"en_US":{}}}',
    '{"catalog":{"en":{"":"Hi"}}}',
    '{"catalog":{},"defaultLocale":null,"revision":"unexpected"}',
);
foreach ($invalid_payloads as $payload) {
    expect_error(
        $store->putRestResponse(new WP_REST_Request($payload, array('If-Match' => $empty['revision']))),
        'wpsuite_translations_invalid_catalog',
        400
    );
}

$legacy_empty = $store->putRestResponse(
    new WP_REST_Request('{"catalog":{}}', array('If-Match' => $empty['revision']))
);
expect(
    $legacy_empty instanceof WP_REST_Response && $legacy_empty->data['defaultLocale'] === null,
    'A legacy catalog-only payload must remain valid for an empty catalog.'
);

$invalid_utf8 = "{\"catalog\":{\"hu\":{\"Hello\":\"\xB1\"}},\"defaultLocale\":\"hu\"}";
expect_error(
    $store->putRestResponse(new WP_REST_Request($invalid_utf8, array('If-Match' => $empty['revision']))),
    'wpsuite_translations_invalid_catalog',
    400
);

$oversized = str_repeat(' ', WPSUITE_CUSTOM_TRANSLATIONS_MAX_BYTES + 16385);
expect_error(
    $store->putRestResponse(new WP_REST_Request($oversized, array('If-Match' => $empty['revision']))),
    'wpsuite_translations_invalid_catalog',
    413
);

$body = json_encode(
    array(
        'catalog' => array(
            'hu' => array('Welcome' => "Üdvözlet\nmásodik sor", 'Empty label' => ''),
            'de' => array('Welcome' => 'Willkommen'),
            'fr' => new stdClass(),
        ),
        'defaultLocale' => 'hu',
    ),
    JSON_UNESCAPED_UNICODE
);
expect(is_string($body), 'The valid test payload must encode.');
$saved = $store->putRestResponse(
    new WP_REST_Request($body, array('If-Match' => '"' . $empty['revision'] . '"'))
);
expect($saved instanceof WP_REST_Response && $saved->status === 200, 'A valid catalog must save.');
expect($saved->data['changed'] === true, 'The first save must be reported as a change.');
expect($saved->data['defaultLocale'] === 'hu', 'The selected default locale must be returned.');
expect(array_keys(get_object_vars($saved->data['catalog'])) === array('de', 'fr', 'hu'), 'Locales must be canonically sorted.');
expect($saved->data['catalog']->hu->{'Empty label'} === '', 'Explicit empty translations must be preserved.');
expect($saved->data['catalog']->fr instanceof stdClass, 'An empty locale dictionary must remain a JSON object.');
expect(
    $GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_OPTION]
        === '{"de":{"Welcome":"Willkommen"},"fr":{},"hu":{"Empty label":"","Welcome":"Üdvözlet\\nmásodik sor"}}',
    'The option must contain canonical JSON.'
);
expect(
    $GLOBALS['wpsuite_test_autoload'][WPSUITE_CUSTOM_TRANSLATIONS_OPTION] === false,
    'The catalog option must disable autoload.'
);
expect(
    $GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION] === 'hu',
    'The default locale must be stored separately.'
);
expect(
    $GLOBALS['wpsuite_test_autoload'][WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION] === false,
    'The default locale option must disable autoload.'
);
expect(!isset($GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_LOCK]), 'The write lock must be released.');

$update_count = count($GLOBALS['wpsuite_test_updates']);
$idempotent = $store->putRestResponse(
    new WP_REST_Request($body, array('If-Match' => $saved->data['revision']))
);
expect($idempotent instanceof WP_REST_Response, 'An idempotent save must succeed.');
expect($idempotent->data['changed'] === false, 'An identical save must be reported as unchanged.');
expect(count($GLOBALS['wpsuite_test_updates']) === $update_count, 'An identical save must not rewrite the option.');

$legacy_body = json_encode(array('catalog' => get_object_vars($saved->data['catalog'])), JSON_UNESCAPED_UNICODE);
expect(is_string($legacy_body), 'The legacy catalog-only payload must encode.');
$legacy_saved = $store->putRestResponse(
    new WP_REST_Request($legacy_body, array('If-Match' => $saved->data['revision']))
);
expect($legacy_saved instanceof WP_REST_Response, 'A legacy catalog-only update must succeed.');
expect($legacy_saved->data['defaultLocale'] === 'hu', 'A legacy update must preserve a still-valid stored default locale.');
expect($legacy_saved->data['changed'] === false, 'A legacy update with unchanged catalog and default must be idempotent.');

$default_changed_body = json_encode(
    array(
        'catalog' => get_object_vars($saved->data['catalog']),
        'defaultLocale' => 'de',
    ),
    JSON_UNESCAPED_UNICODE
);
expect(is_string($default_changed_body), 'The default locale update payload must encode.');
$default_changed = $store->putRestResponse(
    new WP_REST_Request($default_changed_body, array('If-Match' => $saved->data['revision']))
);
expect($default_changed instanceof WP_REST_Response, 'Changing only the default locale must save.');
expect($default_changed->data['changed'] === true, 'Changing only the default locale must change the revision.');
expect($default_changed->data['defaultLocale'] === 'de', 'The updated default locale must be returned.');
expect($default_changed->data['revision'] !== $saved->data['revision'], 'The default locale must participate in the ETag revision.');
expect(
    ($default_changed->headers['ETag'] ?? '') === '"' . $default_changed->data['revision'] . '"',
    'Changing the default locale must return its new strong ETag.'
);

$stale = $store->putRestResponse(
    new WP_REST_Request('{"catalog":{},"defaultLocale":null}', array('If-Match' => $empty['revision']))
);
expect_error($stale, 'wpsuite_translations_revision_conflict', 412);
expect(
    ($stale->get_error_data()['revision'] ?? '') === $default_changed->data['revision'],
    'A stale response must return the current revision.'
);

$GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_LOCK] = array(
    'token' => 'another-request',
    'expires' => time() + 30,
);
$locked = $store->deleteRestResponse(
    new WP_REST_Request('', array('If-Match' => $default_changed->data['revision']))
);
expect_error($locked, 'wpsuite_translations_locked', 409);
unset($GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_LOCK]);

$deleted = $store->deleteRestResponse(
    new WP_REST_Request('', array('If-Match' => $default_changed->data['revision']))
);
expect($deleted instanceof WP_REST_Response && $deleted->data['changed'] === true, 'DELETE must clear a saved catalog.');
expect(
    $deleted->data['catalog'] instanceof stdClass && get_object_vars($deleted->data['catalog']) === array(),
    'DELETE must return the empty catalog as a JSON object.'
);
expect(!isset($GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_OPTION]), 'DELETE must remove the option.');
expect(!isset($GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION]), 'DELETE must remove the default locale option.');

$delete_again = $store->deleteRestResponse(
    new WP_REST_Request('', array('If-Match' => $deleted->data['revision']))
);
expect($delete_again instanceof WP_REST_Response, 'Deleting an empty catalog must succeed.');
expect($delete_again->data['changed'] === false, 'Deleting an empty catalog must be idempotent.');

$GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_OPTION] = '{"de":{},"en-US":{},"fr":{}}';
unset($GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION]);
$legacy_state = $store->getState();
expect($legacy_state['defaultLocale'] === 'en-US', 'A legacy catalog must deterministically prefer English.');
$GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION] = 'missing-locale';
expect($store->getState()['defaultLocale'] === 'en-US', 'An invalid stored default must fail over deterministically.');
unset(
    $GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_OPTION],
    $GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_DEFAULT_LOCALE_OPTION]
);

$GLOBALS['wpsuite_test_can_manage'] = false;
expect_error($store->checkPermission(), 'rest_forbidden', 403);
$GLOBALS['wpsuite_test_can_manage'] = true;
expect($store->checkPermission() === true, 'Administrators must be allowed to manage translations.');

$GLOBALS['wpsuite_test_options'][WPSUITE_CUSTOM_TRANSLATIONS_OPTION] = 'not-json';
expect($store->getState() === $empty, 'Invalid stored data must fail closed to the stable empty catalog.');

fwrite(STDOUT, "WP Suite custom translation catalog checks passed.\n");
