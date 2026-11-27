<?php
namespace SmartCloud\WPSuite\Hub;
define('ABSPATH', '/'); define('MINUTE_IN_SECONDS', 60);
class WP_Error { public function __construct(...$args) {} }
class_alias(WP_Error::class, '\WP_Error');
class SiteSettings {
 public string $workspaceApiMode='workspace', $workspaceId='w', $siteId='s', $siteKey='secret', $platformApiBaseUrl='https://api.example.com', $reCaptchaPublicKey='old'; public bool $useRecaptchaEnterprise=false;
 public static function usableSiteKey($v): bool { return $v === 'secret'; }
 public static function fromArray($v): self { return new self(); }
 public function connectionFingerprint(): string { return 'fingerprint'; }
}
class BackendProfiles { public static function captureContext(): array { return ['id'=>'development']; } public static function status(): array { return ['active'=>'development']; } public static function settings(): SiteSettings { return new SiteSettings(); } }
$GLOBALS['permission']=true; $GLOBALS['options']=[]; $GLOBALS['transients']=[]; $GLOBALS['revision']=1; $GLOBALS['applied']=[];
function current_user_can($c) { return $GLOBALS['permission']; }
function get_option($key,$default=false) { return $GLOBALS['options'][$key] ?? $default; }
function update_option($key,$value,...$rest) { if (($GLOBALS['options'][$key] ?? null) === $value) return false; $GLOBALS['options'][$key]=$value; return true; }
function wp_json_encode($v) { return json_encode($v); }
function wp_parse_url($u,$part=-1) { return parse_url($u,$part); }
function wp_safe_remote_get($url,$args) { $GLOBALS['reviewReads'] = ($GLOBALS['reviewReads'] ?? 0) + 1; return ['body'=>json_encode(['site'=>['workspaceId'=>'w','siteId'=>'s'], 'deploymentCandidates'=>['schemaVersion'=>1,'revision'=>$GLOBALS['revision'],'updatedAt'=>'2026-01-01','candidates'=>empty($GLOBALS['omitReviewCandidates']) ? ['test'=>['schemaVersion'=>1,'fields'=>['x'=>1]]] : []]])]; }
function wp_remote_retrieve_response_code($r) { return 200; } function wp_remote_retrieve_body($r) { return $r['body']; } function is_wp_error($v) { return $v instanceof WP_Error; }
function apply_filters($name,$value,...$args) { if ($name !== 'smartcloud_wpsuite_deployment_candidate_adapters') return $value; return ['test'=>['sections'=>function($fields){ return ['one'=>['title'=>'One','rows'=>[['key'=>'a','label'=>'A','current'=>0,'proposed'=>1]]], 'two'=>['title'=>'Two','rows'=>[['key'=>'b','label'=>'B','current'=>0,'proposed'=>1]]]]; }, 'apply'=>function($section,$fields,$rows) { $GLOBALS['applied'][]=$section; return $section==='two' ? new WP_Error() : true; }]]; }
function map_deep($value, $callback) { return array_map(static fn($v) => sanitize_text_field($v), $value); }
function admin_url($path='') { return 'https://site.example/wp-admin/'.$path; } function wp_unslash($v) { return $v; } function check_admin_referer($v) {} function get_current_blog_id(){return 1;} function get_current_user_id(){return 2;} function sanitize_text_field($s){return $s;} function set_transient($k,$v,$t){$GLOBALS['transients'][$k]=$v;} function wp_safe_redirect($url){} function __($s,$domain=null){return $s;} function wp_die($s){ throw new \RuntimeException($s); } function esc_html($s){return $s;} function esc_html__($s,$domain=null){return $s;}
function get_transient($key) { return $GLOBALS['transients'][$key] ?? false; }
function delete_transient($key) { unset($GLOBALS['transients'][$key]); }
function esc_attr($value) { return htmlspecialchars($value, ENT_QUOTES); }
function esc_url($value) { return esc_attr($value); }
function wp_nonce_field($action) {}
require __DIR__ . '/../php/deployment-review.php';
function check($condition,$message) { if (!$condition) { fwrite(STDERR,"FAIL: $message\n"); exit(1); } }
$review = new DeploymentReview(); $r = new \ReflectionClass($review);
$read=$r->getMethod('read'); $sections=$r->getMethod('sections'); $fingerprint=$r->getMethod('fingerprint'); $identity=$r->getMethod('identity'); $reviewed=$r->getMethod('reviewed');
[$settings,$profile,$batch]=$read->invoke($review); $id=$identity->invoke($review,$settings,$profile); $allSections=$sections->invoke($review,$batch);
check(!$reviewed->invoke($review,$id,1),'new revision pending');
$GLOBALS['options']['smartcloud-wpsuite/deployment-review/'.$id.'/1']=['reviewedRevision'=>1];
check($reviewed->invoke($review,$id,1),'dismissed revision shared'); check(!$reviewed->invoke($review,$id,2),'new revision reappears');
check(isset($review->platformSections(['conflict' => true])['recaptcha']['blocked']), 'conflicting site CAPTCHA stays review-only');
check(is_wp_error($review->platformApply('recaptcha', ['conflict' => true, 'reCaptchaPublicKey' => 'other', 'useRecaptchaEnterprise' => true])), 'conflicting site CAPTCHA cannot be applied');
$scenario=$argv[1]??''; if (!$scenario) {
 $GLOBALS['options']['smartcloud-wpsuite/deployment-review/'.$id.'/1']=['reviewedRevision'=>1, 'outcome'=>'dismiss'];
 $cache = $r->getProperty('pendingByConnection');
 check(!$review->hasPending(), 'dismissed revision hides the navigation indicators');
 ob_start(); $review->render(); $dismissed=ob_get_clean();
 check(str_contains($dismissed,'<details><summary>') && !str_contains($dismissed,'<details open'), 'dismissed recommendations are collapsed');
 check(!str_contains($dismissed,'name="decision"'), 'dismissed recommendations are read-only');
 $GLOBALS['revision']=2;
 $cache->setValue(null, []);
 $reads = $GLOBALS['reviewReads'];
 check($review->hasPending() && (new DeploymentReview())->hasPending(), 'a newer revision shows the pending indicators');
 check($GLOBALS['reviewReads'] === $reads + 1, 'both navigation surfaces share one request-local read');
 $GLOBALS['permission'] = false;
 check(!$review->hasPending(), 'a cached pending revision remains permission filtered');
 $GLOBALS['permission'] = true;
 $cache->setValue(null, []);
 $GLOBALS['omitReviewCandidates'] = true;
 check(!$review->hasPending(), 'a revision without reviewable rows hides the indicators');
 $GLOBALS['omitReviewCandidates'] = false;
 ob_start(); $review->render(); $pending=ob_get_clean();
 check(str_contains($pending,'value="apply"') && !str_contains($pending,'<details><summary>'), 'new revision can be reviewed and applied');
 foreach (['partial','stale','dismiss','dismissed-apply','forbidden'] as $test) { passthru(escapeshellarg(PHP_BINARY).' '.escapeshellarg(__FILE__).' '.escapeshellarg($test),$code); check($code===0,$test); }
 echo "Deployment review behavioral checks passed.\n"; exit;
}
$GLOBALS['options']=[];
$_POST=['identity'=>$id,'connection'=>'fingerprint','revision'=>'1','fingerprint'=>$fingerprint->invoke($review,$allSections),'decision'=>$scenario==='dismiss'?'dismiss':'apply','sections'=>['test:one','test:two']];
if ($scenario==='stale') $GLOBALS['revision']=2;
if ($scenario==='dismissed-apply') $GLOBALS['options']['smartcloud-wpsuite/deployment-review/'.$id.'/1']=['reviewedRevision'=>1, 'outcome'=>'dismiss'];
if ($scenario==='forbidden') $GLOBALS['permission']=false;
register_shutdown_function(function() use ($scenario,$id) {
 $record=$GLOBALS['options']['smartcloud-wpsuite/deployment-review/'.$id.'/1']??null;
 if ($scenario==='partial') { check($GLOBALS['applied']===['one','two'],'both callbacks attempted'); check($record===null,'partial is not acknowledged'); check(count($GLOBALS['transients']['wpsuite_deployment_result_1_2']??[])>=2,'partial results reported'); }
 if ($scenario==='stale') { check(!$GLOBALS['applied'] && $record===null,'stale request rejected'); }
 if ($scenario==='dismiss') { check(($record['outcome']??null)==='dismiss','dismissal persisted'); }
 if ($scenario==='dismissed-apply') { check(!$GLOBALS['applied'] && ($record['outcome']??null)==='dismiss','a previously opened form cannot overwrite a dismissal'); }
 if ($scenario==='forbidden') check(!$GLOBALS['applied'] && $record===null,'permission denied');
});
try { $review->submit(); } catch (\RuntimeException $e) { if ($scenario!=='forbidden') throw $e; }
