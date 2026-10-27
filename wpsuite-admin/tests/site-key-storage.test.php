<?php
/** Real crypto and real exact-option filters with only public synthetic credentials. */
declare(strict_types=1);
use SmartCloud\WPSuite\Hub\SiteSettings;
use SmartCloud\WPSuite\Hub\SiteKeyStorage;
define('ABSPATH', __DIR__ . '/');
$child = $argv[1] ?? '';
if ($child === '--rotated') $GLOBALS['fixture_key_rotation'] = 'rotated';
if ($child !== '--missing') require_once __DIR__ . '/site-key-storage-fixture.php';
require_once dirname(__DIR__) . '/php/model.php';
$GLOBALS['storage_options'] = array(); $GLOBALS['storage_filters'] = array(); $GLOBALS['storage_writes'] = 0;
function add_filter(string $hook, mixed $callback, int $priority=10, int $accepted=1): bool { $GLOBALS['storage_filters'][$hook]=$callback; return true; }
function get_option(string $name,mixed $default=false):mixed {
    $raw=$GLOBALS['storage_options'][$name]??$default;
    return isset($GLOBALS['storage_filters']['option_'.$name])?($GLOBALS['storage_filters']['option_'.$name])($raw):$raw;
}
function update_option(string $name,mixed $value,mixed $autoload=null):bool {
    $GLOBALS['storage_writes']++;if($GLOBALS['storage_write_failure']??false)return false;
    $GLOBALS['storage_options'][$name]=is_object($value)?clone $value:$value;return true;
}
function check(bool $test,string $message):void {if(!$test)throw new RuntimeException($message);}
function rejected(callable $fn):void {try{$fn();}catch(RuntimeException $expected){return;}throw new RuntimeException('Expected fail-closed rejection');}
SiteKeyStorage::registerFilters();
if ($child === '--rotated' || $child === '--missing') {
    $raw=unserialize(file_get_contents($argv[2]),array('allowed_classes'=>array(SiteSettings::class)));
    $GLOBALS['storage_options']['smartcloud-wpsuite/site-settings']=$raw;
    $read=get_option('smartcloud-wpsuite/site-settings');
    check($read->siteKey===''&&$read->workspaceId==='synthetic-workspace','Locked envelope must preserve identity and suppress credential');
    $before=serialize($GLOBALS['storage_options']);SiteKeyStorage::migratePlaintextOptions();
    check($before===serialize($GLOBALS['storage_options'])&&$GLOBALS['storage_writes']===0,'Locked envelope changed');
    rejected(fn()=>SiteKeyStorage::encode($read));
    if($child==='--missing')check(!SiteKeyStorage::availability()['ready'],'Missing constants accepted');
    else {
        $read->siteKey='synthetic-explicit-reconnect';
        $reconnected=SiteKeyStorage::encode($read);
        check(SiteKeyStorage::read($reconnected,'reconnect')->siteKey==='synthetic-explicit-reconnect','Explicit reconnect after salt rotation failed');
    }
    echo "Locked envelope remains unchanged and fails closed.\n";exit;
}
$original=new SiteSettings(workspaceId:'synthetic-workspace',siteId:'synthetic-site',siteKey:'synthetic-existing-key',workspaceApiMode:'workspace',platformApiBaseUrl:'https://foundation.example',platformConfigUrl:'https://delivery.example/dev.json');
$original->futureExtension=array('keep'=>true);$snapshot=serialize($original);
check(SiteKeyStorage::availability()['ready'],'Synthetic strong prerequisites unavailable');
$duplicate=clone $original;$duplicate->futureExtension=array('oldSiteKey'=>$original->siteKey);
rejected(fn()=>SiteKeyStorage::encode($duplicate));
$sealed=SiteKeyStorage::encode($original);
check(SiteKeyStorage::isSealed($sealed->siteKey),'Key not sealed');
check(serialize($original)===$snapshot,'Encoder mutated its source object');
check(!str_contains(serialize($sealed),'synthetic-existing-key'),'Plaintext duplicate persisted');
$rawBefore=serialize($sealed);$read=SiteKeyStorage::read($sealed,'smartcloud-wpsuite/site-settings');
check(serialize($read)===$snapshot,'Healthy exact runtime serialized shape changed');
check(serialize($sealed)===$rawBefore,'Read mutated raw object or WordPress cache reference');
check(SiteKeyStorage::encode($read)->siteKey===$sealed->siteKey,'Unchanged binding/key generated fresh sealed bytes');
foreach(array('workspaceId','siteId','workspaceApiMode','platformApiBaseUrl','platformConfigUrl')as$field){
    $tampered=clone $sealed;
    if($field==='workspaceId'){$tampered->workspaceId='foreign';$tampered->accountId='foreign';}
    elseif($field==='workspaceApiMode')$tampered->$field='legacy';
    elseif($field==='platformApiBaseUrl')$tampered->$field='https://other.example';
    elseif($field==='platformConfigUrl')$tampered->$field='https://delivery.example/other.json';
    else $tampered->$field='foreign';
    check(SiteKeyStorage::read($tampered,'tamper-'.$field)->siteKey==='','AAD tampering accepted');
}
foreach(array('iv','tag','data')as$field){
    $tampered=clone $sealed;$envelope=json_decode(base64_decode(substr($tampered->siteKey,strlen(SiteKeyStorage::PREFIX))),true);
    $value=base64_decode($envelope[$field]);$value[0]=chr(ord($value[0])^1);$envelope[$field]=base64_encode($value);
    $tampered->siteKey=SiteKeyStorage::PREFIX.base64_encode(json_encode($envelope));
    check(SiteKeyStorage::read($tampered,'tamper-'.$field)->siteKey==='','Cipher/tag/nonce tampering accepted');
}
foreach(array('wpsuite-key:v2:unsupported','wpsuite-key:v1:not-base64','wpsuite-key:v1:'.base64_encode('{}'))as$invalid){
    $tampered=clone$sealed;$tampered->siteKey=$invalid;check(SiteKeyStorage::read($tampered,'tamper-envelope')->siteKey==='','Invalid envelope accepted');
    check(!SiteSettings::usableSiteKey($invalid),'Envelope can be mistaken for a credential');
}
// Real filters transparently support both object and direct-array option consumers.
$GLOBALS['storage_options']['smartcloud-wpsuite/site-settings']=$sealed;
$GLOBALS['storage_options']['hub-for-wpsuiteio/site-settings']=get_object_vars($original);
check(serialize(get_option('smartcloud-wpsuite/site-settings'))===$snapshot,'Direct object option consumer changed');
SiteKeyStorage::migratePlaintextOptions();
check(SiteKeyStorage::isSealed($GLOBALS['storage_options']['hub-for-wpsuiteio/site-settings']['siteKey']),'Legacy plaintext mirror not migrated');
check(get_option('hub-for-wpsuiteio/site-settings')['siteKey']==='synthetic-existing-key','Direct array option consumer lost key');
$writes=$GLOBALS['storage_writes'];$stored=serialize($GLOBALS['storage_options']);SiteKeyStorage::migratePlaintextOptions();
check($writes===$GLOBALS['storage_writes']&&$stored===serialize($GLOBALS['storage_options']),'Second boot rewrote sealed options');
$GLOBALS['storage_options']['smartcloud-wpsuite/site-settings']=clone $original;
$beforeFailed=serialize($GLOBALS['storage_options']);$GLOBALS['storage_write_failure']=true;
SiteKeyStorage::migratePlaintextOptions();
check(get_option('smartcloud-wpsuite/site-settings')->siteKey==='', 'Failed migration left plaintext runtime fallback');
check(serialize($GLOBALS['storage_options'])===$beforeFailed,'Failed DB migration modified its before-image');
$GLOBALS['storage_write_failure']=false;
$dir=sys_get_temp_dir().'/wpsuite-key-storage-test-'.bin2hex(random_bytes(8));mkdir($dir,0700);$path=$dir.'/synthetic-envelope';file_put_contents($path,serialize($sealed));chmod($path,0600);
try{
    foreach(array('--missing','--rotated')as$mode){
        $command=escapeshellarg(PHP_BINARY).' '.escapeshellarg(__FILE__).' '.escapeshellarg($mode).' '.escapeshellarg($path);
        exec($command,$output,$status);check($status===0,'Salt/missing-constant subprocess failed');
    }
}finally{unlink($path);rmdir($dir);}
echo "SiteKey storage: AES-GCM/HKDF, raw-object immutability, exact runtime compatibility, full-tuple AAD, tamper rejection, no plaintext duplicate, direct option readers, idempotent migration, missing constants and salt rotation passed.\n";
