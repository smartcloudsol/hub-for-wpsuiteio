<?php
declare(strict_types=1);
use SmartCloud\WPSuite\Hub\HubAdmin;
use SmartCloud\WPSuite\Hub\SiteSettings;
use SmartCloud\WPSuite\Hub\SiteKeyStorage;
require_once __DIR__ . '/site-key-storage-fixture.php';
define('ABSPATH', __DIR__ . '/');
define('SMARTCLOUD_WPSUITE_PATH', dirname(__DIR__) . '/php/');
define('SMARTCLOUD_WPSUITE_CANONICAL_SLUG', 'smartcloud-wpsuite');
define('SMARTCLOUD_WPSUITE_LEGACY_SLUG', 'hub-for-wpsuiteio');
class WP_Error { public function __construct(public string $code='', public string $message='', public array $data=[]) {} }
class WP_REST_Request { public function __construct(private string $body) {} public function get_body():string{return $this->body;} }
class WP_REST_Response { public function __construct(public mixed $data,public int $status) {} }
function add_filter(string $hook,mixed $callback,int $priority=10,int $accepted_args=1):bool{$GLOBALS['filters'][$hook]=$callback;return true;}
function get_option(string $key,mixed $default=false):mixed{$value=$GLOBALS['options'][$key]??$default;return isset($GLOBALS['filters']['option_'.$key])?($GLOBALS['filters']['option_'.$key])($value):$value;}
function update_option(string $key,mixed $value,mixed $autoload=null):bool{$GLOBALS['writes'][]=$key;$GLOBALS['options'][$key]=$value;return true;}
function delete_option(string $key):bool{$GLOBALS['deletes'][]=$key;unset($GLOBALS['options'][$key]);return true;}
function sanitize_text_field(string $value):string{return trim(strip_tags($value));}
function is_wp_error(mixed $value):bool{return $value instanceof WP_Error;}
function get_site_url():string{return 'https://dev.wpsuite.io';}
function wp_remote_get(string $url,array $args):mixed {
    $GLOBALS['requests'][]=array('url'=>$url,'args'=>$args);
    if($GLOBALS['network']==='error')return new WP_Error('synthetic');
    if($GLOBALS['network']==='http')return ['status'=>403,'body'=>'{}'];
    if($GLOBALS['network']==='invalid')return ['status'=>200,'body'=>'{"config":"invalid","jws":"invalid"}'];
    return ['status'=>200,'body'=>'{"config":"new:encrypted","jws":"new.license.signature"}'];
}
function wp_remote_post(string $url,array $args):mixed {$GLOBALS['posts'][]=['url'=>$url,'args'=>$args];return new WP_Error('synthetic_retention_unavailable');}
function wp_remote_retrieve_response_code(array $response):int{return $response['status'];}
function wp_remote_retrieve_body(array $response):string{return $response['body'];}
require_once dirname(__DIR__) . '/php/index.php';
SiteKeyStorage::registerFilters();
function check(bool $condition,string $message):void{if(!$condition)throw new RuntimeException($message);}
$reflection=new ReflectionClass(HubAdmin::class);
$hub=$reflection->newInstanceWithoutConstructor();
$property=$reflection->getProperty('siteSettings');
$binding=$reflection->getMethod('hasCurrentConfigBinding');
$old=SiteSettings::fromArray(['workspaceId'=>'old-workspace','siteId'=>'old-site','siteKey'=>'synthetic-old','subscriber'=>true]);
$new=['workspaceId'=>'new-workspace','accountId'=>'new-workspace','siteId'=>'new-site','siteKey'=>'synthetic-new','subscriber'=>true,'workspaceApiMode'=>'workspace','platformApiBaseUrl'=>'https://eu.example/dev','platformConfigUrl'=>'https://delivery.example/dev.json'];
function resetFixture():void {
    global $property,$hub,$old;
    $property->setValue($hub,clone $old);
    $GLOBALS['options']=['smartcloud-wpsuite/site-settings'=>clone $old,'hub-for-wpsuiteio/site-settings'=>clone $old,'smartcloud-wpsuiteio/config-encrypted'=>'old:encrypted','smartcloud-wpsuiteio/license-jws'=>'old.license.signature','smartcloud-wpsuiteio/license-last-refresh'=>123,'smartcloud-wpsuiteio/license-binding'=>$old->connectionFingerprint()];
    $GLOBALS['requests']=$GLOBALS['writes']=$GLOBALS['deletes']=$GLOBALS['posts']=[];
    $GLOBALS['network']='ok';
}
function saveCandidate(array $values):mixed {global $hub;return $hub->updateSiteSettings(new WP_REST_Request(json_encode((object)$values,JSON_THROW_ON_ERROR)));}
foreach ([null,'','undefined','UNDEFINED','null',"bad key","bad\nkey",123] as $invalid) {
    resetFixture();$before=serialize($GLOBALS['options']);
    $result=saveCandidate(array_replace($new,['siteKey'=>$invalid]));
    check($result instanceof WP_Error&&$result->data['status']===400,'Invalid credential accepted');
    check(!$GLOBALS['requests']&&!$GLOBALS['writes']&&!$GLOBALS['deletes']&&serialize($GLOBALS['options'])===$before,'Invalid credential changed local state or used network');
}
check(SiteSettings::fromArray(['siteKey'=>'undefined'])->siteKey==='','Stored sentinel must remain repairable');
foreach (['error','http','invalid'] as $failure) {
    resetFixture();$GLOBALS['network']=$failure;$before=serialize($GLOBALS['options']);
    $result=saveCandidate($new);
    check($result instanceof WP_Error&&$result->data['status']===502&&$result->data['connectionUpdated']===false,'Failed refresh must be explicit');
    check(serialize($GLOBALS['options'])===$before&&!$GLOBALS['writes']&&!$GLOBALS['deletes'],'Failed candidate must preserve previous complete binding');
    check($property->getValue($hub)->workspaceId==='old-workspace','Failed candidate became runtime identity');
}
resetFixture();$result=saveCandidate($new);
check($result instanceof WP_REST_Response&&$result->status===200,'Verified paid candidate rejected');
check($binding->invoke($hub),'New verified cache is not bound');
check(get_option('smartcloud-wpsuite/site-settings')->siteKey==='synthetic-new','Creation handoff key was not persisted unchanged');
check(get_option('hub-for-wpsuiteio/site-settings')->siteKey==='synthetic-new','Compatibility option lost creation handoff key');
check(!str_contains(serialize($GLOBALS['options']['smartcloud-wpsuite/site-settings']), 'synthetic-new'), 'Plaintext credential persisted');
check($GLOBALS['requests'][0]['args']['headers']['X-Site-Key']==='synthetic-new','Paid refresh did not use the handed-off SiteKey');
check(!isset($GLOBALS['requests'][0]['args']['headers']['Authorization']),'Paid refresh must not require a Cognito session');
check($GLOBALS['options']['smartcloud-wpsuiteio/config-encrypted']==='new:encrypted','Old Pro config survived connection');
check($GLOBALS['options']['smartcloud-wpsuiteio/license-jws']==='new.license.signature','Old licence survived connection');
check($GLOBALS['requests'][0]['url']==='https://eu.example/dev/workspace/new-workspace/site/new-site/license?licenseVersion=1','Wrong licence endpoint');
check($GLOBALS['requests'][0]['args']['redirection']===0,'Credential request must not follow redirects');
check(end($GLOBALS['writes'])==='smartcloud-wpsuiteio/license-binding','Cache becomes usable only after both assets are saved');
check(count($GLOBALS['posts'])===1&&$GLOBALS['posts'][0]['url']==='https://eu.example/dev/workspace/new-workspace/site/new-site/site-key/retain','Explicit workspace same-key retention missing');
check($GLOBALS['posts'][0]['args']['headers']===['Accept'=>'application/json','X-Site-Key'=>'synthetic-new']&&!isset($GLOBALS['posts'][0]['args']['body']),'Retention must use only existing SiteKey header, never JWT or credential body');
check($GLOBALS['posts'][0]['args']['redirection']===0&&$GLOBALS['posts'][0]['args']['cookies']===[],'Retention must not forward credentials or cookies');
foreach (['workspaceId','siteId','siteKey','workspaceApiMode','platformApiBaseUrl','platformConfigUrl'] as $field) {
    $saved=clone $property->getValue($hub);$changed=clone $saved;$changed->$field.='-other';$property->setValue($hub,$changed);
    check(!$binding->invoke($hub),'Foreign '.$field.' accepted old cache');$property->setValue($hub,$saved);
}
unset($GLOBALS['options']['smartcloud-wpsuiteio/license-binding']);check(!$binding->invoke($hub),'Unbound legacy cache must not be served as verified');
resetFixture();$reader=$reflection->getMethod('readConnectionConfig');
$legacyAssets=$reader->invoke($hub,$old,$old->workspaceId,$old->siteId,$old->siteKey);
check(is_array($legacyAssets)&&!$GLOBALS['posts'],'Legacy licence fetch must never retain into Foundation');
resetFixture();$result=saveCandidate(array_replace($new,['subscriber'=>false]));
check($result instanceof WP_REST_Response&&!$GLOBALS['requests'],'Free connection does not require paid assets');
foreach (['license-binding','config-encrypted','license-jws','license-last-refresh'] as $suffix)check(!isset($GLOBALS['options']['smartcloud-wpsuiteio/'.$suffix]),'Free connection retained paid '.$suffix);
resetFixture();$result=saveCandidate([]);
check($result instanceof WP_REST_Response&&$property->getValue($hub)->siteId==='','Disconnect failed');
check(!$binding->invoke($hub),'Disconnected cache remains bound');
echo "Site connection PHP regressions passed: invalid credentials, transactional failures, verified replacement, full tuple cache binding, free/disconnect invalidation.\n";
