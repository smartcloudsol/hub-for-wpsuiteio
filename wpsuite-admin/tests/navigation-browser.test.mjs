/** Run after build-wp: node tests/navigation-browser.test.mjs /tmp/wpsuite-admin-ux-wp */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const output = resolve(process.argv[2] ?? '/tmp/wpsuite-admin-ux-wp');
const runtime = await build({
  stdin: { contents: "import * as jsx from 'react/jsx-runtime'; window.ReactJSXRuntime = jsx;", resolveDir: root },
  bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shared-react' }));
    builder.onLoad({ filter: /.*/, namespace: 'shared-react' }, () => ({ contents: 'module.exports = window.React;' }));
  } }],
});
const link = { label: 'AI Kit settings', url: '/wp-admin/admin.php?page=ai-kit' };
const capability = {
  id: 'answers', label: 'Answers', product: 'AI Kit',
  description: 'Chatbot and DocSearch use the same knowledge base.',
  url: '/wp-admin/admin.php?page=answers', primary: link,
  quick_links: [{ label: 'Content library', url: '/wp-admin/edit.php' }, { ...link, label: 'Shared settings shortcut' }], advanced_links: [link],
};
const bootstrap = {
  schema_version: 1, view: 'overview', overview_url: '/?view=overview', advanced_url: '/?view=advanced',
  can_manage_connection: false,
  capabilities: [capability, { ...capability, id: 'ai-tools', label: 'AI Tools' }],
  platform_links: [],
  discovery: [{ id: 'flow', label: 'Forms & Workflows', product: 'SmartCloud Flow', description: 'Build forms.', state: 'not_installed', message: 'Available through WordPress.org.', action: { label: 'Install Forms & Workflows', url: '/wp-admin/plugin-install.php' } }],
};
const fixtures = new Map();
const overviewCases = new Map();
const requests = [];
const suggestionRequests = [];
const resetCases = new Map();
function fixture(configured = false) {
  return {
    surface: {
      schema_version: 1, configured, can_edit: true, revision: 'r1',
      status: { state: configured ? 'ready' : 'needs_setup', label: configured ? 'Settings configured' : 'Setup needed' },
      notice: 'Saved settings do not verify a remote backend.', metrics: [{ label: 'Sources', value: 7 }],
      values: { target: 'https://original.example.test', enabled: true, limit: 5, layout: 'compact' },
      steps: [
        { id: 'target', title: 'Choose a target', description: 'Set the target.', fields: [{ id: 'target', label: 'Target URL', type: 'url', required: true }] },
        { id: 'preferences', title: 'Preferences', fields: [
          { id: 'enabled', label: 'Enable sync', type: 'checkbox' },
          { id: 'limit', label: 'Page limit', type: 'number', required: true },
          { id: 'layout', label: 'Layout', type: 'select', required: true, options: [{ label: 'Compact', value: 'compact' }, { label: 'Wide', value: 'wide' }] },
        ] },
      ],
      actions: [{ id: 'publish', label: 'Queue publish', confirm: 'This queues a full publish.', fields: [{ id: 'title', label: 'Run title', type: 'text', required: true }] }],
      links: [{ ...link, label: 'Detailed chatbot configuration' }], runtime_plugin: 'fixture-plugin', runtime_fields: [{ label: 'Remote entries', path: 'entries', format: 'count' }],
    },
    advanced: { preserved: 'sentinel' }, patches: [], actions: [], reads: 0,
  };
}
function gateyFixture(name, configured = false) {
  const entry = fixture(configured);
  entry.surface.values = { userPoolId: 'eu-central-1_FIXTURE', userPoolClientId: 'fixtureclient', loginMechanism: 'existing', signInPage: '', hideSignUp: false };
  entry.surface.steps = [
    { id: 'connection', title: 'Connect your sign-in service', fields: [
      { id: 'userPoolId', label: 'User pool ID', type: 'text', required: true },
      { id: 'userPoolClientId', label: 'Public app client ID', type: 'text', required: true },
    ] },
    { id: 'experience', title: 'Choose the sign-in experience', fields: [
      { id: 'loginMechanism', label: 'Sign-in identifier', type: 'select', options: [
        { value: 'existing', label: 'Keep current methods' }, { value: 'email', label: 'Email' },
        { value: 'username', label: 'Username' }, { value: 'phone_number', label: 'Phone number' },
      ] },
      { id: 'signInPage', label: 'Sign-in page path', type: 'text', suggestions_url: `/surface/${name}/suggestions` },
      { id: 'hideSignUp', label: 'Hide registration', type: 'checkbox' },
    ] },
  ];
  entry.surface.actions = [];
  return entry;
}
function siteUseFixture(configured = true) {
  const entry = fixture(configured);
  entry.surface.actions = [];
  entry.surface.use_on_site = {
    description: 'Open a page and add the named native Gutenberg block. Your existing content remains unchanged.',
    items: [
      { id: 'form', title: 'Flow Form', description: 'Set Endpoint path in the form inspector to use your own HTTPS endpoint. Your service must allow CORS and return JSON.',
        links: [{ label: 'Open a new page', url: '/wp-admin/post-new.php?post_type=page' }, { label: 'Browse pages', url: '/wp-admin/edit.php' }, { label: 'Duplicate page resource', url: '/wp-admin/edit.php' }] },
      { id: 'modal', title: 'Flow Modal', description: 'Add Gutenberg content inside a modal.', links: [{ label: 'Open a new page', url: '/wp-admin/post-new.php?post_type=page' }] },
      { id: 'gallery', title: 'Gallery', description: 'Choose Gallery from the SmartCloud Flow category.', links: [] },
      { id: 'content-root', title: 'Flow Content Root', description: 'Use Flow display blocks outside forms.', status: 'Configured page: /sign-in/', links: [] },
    ],
  };
  return entry;
}
const overviewStatus = fixture(true);
overviewStatus.surface.status.label = 'Knowledge sources';
overviewStatus.surface.metrics = [{ label: 'Knowledge sources', value: 17 }, { label: 'Queued updates', value: 3 }];
fixtures.set('overview-status', overviewStatus);
const overviewUnavailable = fixture(true); overviewUnavailable.getError = true;
fixtures.set('overview-unavailable', overviewUnavailable);
const files = new Map([
  ['/react.js', resolve(dirname(require.resolve('react/package.json')), 'umd/react.production.min.js')],
  ['/react-dom.js', resolve(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.production.min.js')],
  ['/mantine.js', resolve(root, '../wpsuite-mantine-vendor/dist/mantine-vendor.min.js')],
  ['/mantine.css', resolve(root, '../wpsuite-mantine-vendor/dist/mantine-vendor.css')],
]);
if (process.env.WPSUITE_WORDPRESS_CSS) files.set('/wordpress-admin.css', process.env.WPSUITE_WORDPRESS_CSS);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/reset/')) {
      const entry = resetCases.get(url.pathname.split('/')[2]);
      response.setHeader('Content-Type', 'application/json');
      if (!entry) { response.writeHead(404).end(JSON.stringify({ message: 'Unavailable' })); return; }
      assert.equal(request.headers['x-wp-nonce'], 'surface-nonce');
      if (entry.forbidden) { response.writeHead(403).end(JSON.stringify({ message: 'Forbidden' })); return; }
      if (request.method === 'GET') { entry.reads++; response.end(JSON.stringify(entry.review)); return; }
      let raw = ''; for await (const part of request) raw += part;
      const body = JSON.parse(raw); entry.posts.push(body);
      assert.deepEqual(Object.keys(body).sort(), ['confirm', 'revision']);
      assert.equal(body.confirm, true);
      if (body.revision !== entry.review.revision) { response.writeHead(409).end(JSON.stringify({ message: 'Settings changed. Review the latest reset details.' })); return; }
      if (entry.gate) await entry.gate;
      response.end(JSON.stringify({ reset: true, reload_required: true })); return;
    }
    if (url.pathname.startsWith('/surface/')) {
      const name = url.pathname.split('/')[2];
      const entry = fixtures.get(name);
      if (!entry) { response.writeHead(404).end(); return; }
      requests.push({ method: request.method, path: url.pathname, nonce: request.headers['x-wp-nonce'] });
      response.setHeader('Content-Type', 'application/json');
      if (request.headers['x-wp-nonce'] !== 'surface-nonce') { response.writeHead(403).end(JSON.stringify({ message: 'Nonce missing' })); return; }
      if (request.method === 'GET' && url.pathname.endsWith('/suggestions')) {
        const query = url.searchParams.get('q') ?? '';
        const lookup = { name, query, nonce: request.headers['x-wp-nonce'], aborted: false };
        suggestionRequests.push(lookup);
        response.on('close', () => { if (!response.writableEnded) lookup.aborted = true; });
        if (query === 'slow') await new Promise(resolve => setTimeout(resolve, 850));
        if (query === 'error') { response.writeHead(503).end(JSON.stringify({ message: 'Page lookup unavailable.' })); return; }
        const items = query === 'slow' ? [{ value: 'old-sign-in', label: 'Stale result · old-sign-in · #9' }]
          : query === '17' ? [{ value: 'sign-in', label: 'Sign in · sign-in · #17' }]
          : query === 'account/sign-in' ? [{ value: 'account/sign-in', label: 'Account login · account/sign-in · #24' }]
          : query === 'empty' ? [] : [{ value: 'sign-in', label: 'Sign in · sign-in · #17' }, { value: 'account/sign-in', label: 'Account login · account/sign-in · #24' }];
        response.end(JSON.stringify(items)); return;
      }
      if (request.method === 'GET') {
        entry.reads++;
        if (entry.getError) { response.writeHead(503).end(JSON.stringify({ message: 'The local provider is temporarily unavailable.' })); return; }
        response.end(JSON.stringify(entry.surface)); return;
      }
      let raw = ''; for await (const part of request) raw += part;
      const body = JSON.parse(raw);
      if (request.method === 'PATCH') {
        entry.patches.push(body);
        if (entry.conflict) {
          entry.conflict = false;
          entry.surface.values.target = 'https://concurrent.example.test'; entry.surface.revision = 'r2';
          response.writeHead(409).end(JSON.stringify({ message: 'Another administrator changed these settings.' })); return;
        }
        assert.equal(body.revision, entry.surface.revision);
        assert.deepEqual(Object.keys(body).sort(), ['revision', 'values']);
        assert.deepEqual(Object.keys(body.values).sort(), entry.surface.steps.flatMap(step => step.fields.map(field => field.id)).sort());
        entry.surface.values = { ...entry.surface.values, ...body.values }; entry.surface.configured = true;
        entry.surface.revision = 'r3'; entry.surface.status = { state: 'ready', label: 'Settings configured' };
        response.end(JSON.stringify(entry.surface)); return;
      }
      if (request.method === 'POST' && url.pathname.endsWith('/action')) {
        entry.actions.push(body);
        assert.deepEqual(Object.keys(body).sort(), ['action', 'input']);
        if (entry.actionError) { entry.actionError = false; response.writeHead(500).end(JSON.stringify({ message: 'Runner unavailable. Try again.' })); return; }
        response.end(JSON.stringify({ message: 'Publish queued.', redirect: '/wp-admin/admin.php?page=publisher' })); return;
      }
      response.writeHead(405).end(); return;
    }
    if (url.pathname === '/') {
      const view = url.searchParams.get('view') ?? 'overview';
      const surface = url.searchParams.get('surface');
      const isAdmin = url.searchParams.has('admin');
      const data = view === 'malformed' ? '{' : JSON.stringify({ ...bootstrap, view, active_id: 'answers',
        can_manage_connection: isAdmin, rest_nonce: 'surface-nonce',
        platform_links: isAdmin ? [{ label: 'Platform Settings', url: '/wp-admin/admin.php?page=platform-settings' }] : [],
        capabilities: overviewCases.get(url.searchParams.get('overview-case')) ?? (surface ? [{ ...capability, surface_url: `/surface/${surface}`, reset_url: url.searchParams.has('reset') ? `/reset/${surface}` : undefined, surface_extension: url.searchParams.get('extension'), has_details: url.searchParams.has('integrated') }] : url.searchParams.has('statuses') ? [
          { ...capability, surface_url: '/surface/overview-status' },
          { ...capability, id: 'ai-tools', label: 'AI Tools', surface_url: '/surface/overview-unavailable' },
        ] : bootstrap.capabilities),
      });
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/wordpress-admin.css"><link rel="stylesheet" href="/mantine.css"><link rel="stylesheet" href="/build/admin.css"></head><body class="wp-admin wp-core-ui"><div id="smartcloud-wpsuite-admin"></div>${url.searchParams.has('native-reset') ? `<div id="wpsuite-config-reset" data-reset-url="/reset/native" data-rest-nonce="surface-nonce"></div>` : ''}${url.searchParams.has('integrated') ? '<section id="wpsuite-product-details" hidden><label>Native staged value<input id="native-draft" value="original"></label></section>' : ''}<script>document.getElementById('smartcloud-wpsuite-admin').dataset.navigation=${JSON.stringify(data)};window.WpSuite={view:'connect',plugins:{},siteSettings:${JSON.stringify(url.searchParams.has('connected') ? { accountId: 'fixture-account', siteId: 'fixture-site', siteKey: 'synthetic-not-a-secret' } : {})},nonce:'synthetic'};</script><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/jsx.js"></script><script>window.wp={i18n:{__:(text)=>text,sprintf:(text,value)=>text.replace('%s',value)},components:{__experimentalHeading:({level=1,children,...props})=>React.createElement('h'+level,props,children)}};window.jQuery=()=>{};</script><script src="/mantine.js"></script><script src="/build/admin.js"></script></body></html>`);
      return;
    }
    if (url.pathname === '/jsx.js') {
      response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      response.end(runtime.outputFiles[0].text);
      return;
    }
    const path = files.get(url.pathname) ?? (url.pathname.startsWith('/build/') ? resolve(output, url.pathname.slice(7)) : null);
    if (!path || (!files.has(url.pathname) && !path.startsWith(`${output}/`))) {
      response.writeHead(404).end(); return;
    }
    response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8');
    response.end(await readFile(path));
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--disable-gpu", "--disable-software-rasterizer"] });
  for (const width of [1280, 390]) {
    const name = `reset-${width}`;
    const entry = fixture(true); fixtures.set(name, entry);
    const reset = { reads: 0, posts: [], review: { schema_version: 1, revision: 'reset-1', title: 'Reset Gatey settings', consequences: ['Both user pools, domain rules, and WordPress login integration will be removed.'], preserved: ['WordPress content, AWS resources, and the shared site connection are preserved.'] } };
    resetCases.set(name, reset);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${origin}/?view=capability&surface=${name}&reset=1&integrated=1`);
    const trigger = page.getByRole('button', { name: 'Reset settings…', exact: true });
    await trigger.waitFor();
    assert.equal(await trigger.count(), 1, 'Reset is not duplicated');
    const initialReads = reset.reads;
    await trigger.click();
    const modal = page.getByRole('dialog');
    await modal.getByText(reset.review.consequences[0]).waitFor();
    assert.ok(reset.reads > initialReads, 'Opening confirmation fetches a fresh revision');
    await expect(modal.getByRole('button', { name: 'Reset settings', exact: true })).toBeDisabled();
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(reset.posts.length, 0, 'Cancel does not reset configuration');
    await trigger.click();
    await modal.getByText(reset.review.consequences[0]).waitFor();
    reset.review.revision = 'reset-2';
    await modal.getByRole('checkbox').check();
    await modal.getByRole('button', { name: 'Reset settings', exact: true }).click();
    await modal.getByRole('alert').filter({ hasText: 'Settings changed.' }).waitFor();
    assert.deepEqual(reset.posts, [{ revision: 'reset-1', confirm: true }]);
    assert.equal(await modal.getByRole('button', { name: 'Reset settings', exact: true }).count(), 0, 'Stale revision cannot be retried without a fresh review');
    await modal.getByRole('button', { name: 'Review latest reset details', exact: true }).click();
    await modal.getByRole('checkbox').waitFor();
    await expect(modal.getByRole('checkbox')).not.toBeChecked();
    await modal.getByRole('checkbox').check();
    let release; reset.gate = new Promise(resolve => { release = resolve; });
    await modal.getByRole('button', { name: 'Reset settings', exact: true }).click();
    await expect(modal.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(modal).toBeVisible();
    await page.screenshot({ path: `/tmp/wpsuite-reset-confirm-${width}.png`, fullPage: true, animations: 'disabled' });
    const reloaded = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
    release();
    await reloaded;
    assert.equal(new URL(page.url()).searchParams.has('panel'), false);
    await page.getByRole('textbox', { name: 'Target URL', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.has('setup'), false, 'Starting the reset wizard consumes the one-time setup intent');
    assert.deepEqual(reset.posts[1], { revision: 'reset-2', confirm: true });
    assert.equal(entry.patches.length, 0, 'Reset opens setup without implicitly saving it');
    if (width === 1280) {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await page.getByText('Settings saved.', { exact: true }).waitFor();
    } else {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    assert.equal(new URL(page.url()).searchParams.has('setup'), false, 'Finish or cancel consumes the reset setup intent');
    await page.close();
  }
  for (const name of ['readonly', 'forbidden', 'unsupported', 'no-wizard', 'answers-extension', 'readonly-base']) {
    const entry = fixture(true);
    if (['readonly', 'answers-extension', 'readonly-base'].includes(name)) entry.surface.can_edit = false;
    if (['no-wizard', 'answers-extension'].includes(name)) { entry.surface.steps = []; entry.surface.values = {}; }
    fixtures.set(name, entry);
    resetCases.set(name, { reads: 0, posts: [], forbidden: name === 'readonly' || name === 'forbidden', review: { schema_version: 1, revision: 'r1', title: 'Reset settings', consequences: ['All plugin settings are removed.'], preserved: ['Content is preserved.'] } });
    if (name === 'unsupported') resetCases.delete(name);
    const page = await browser.newPage();
    if (name === 'answers-extension') await page.addInitScript(() => {
      window.smartcloudWpSuiteSurfaces = { answers: element => {
        element.textContent = 'Plugin-owned Answers setup';
        return () => { element.textContent = ''; };
      } };
    });
    await page.goto(`${origin}/?view=capability&surface=${name}${name === 'readonly' ? '' : '&reset=1'}${name === 'answers-extension' ? '&extension=answers' : ''}`);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.getByRole('button', { name: 'Reset settings…', exact: true }).count(), ['no-wizard', 'answers-extension', 'readonly-base'].includes(name) ? 1 : 0, 'Reset permission is independent from generic surface editing');
    if (name === 'answers-extension') await page.getByText('Plugin-owned Answers setup', { exact: true }).waitFor();
    if (name === 'readonly') assert.equal(resetCases.get(name).reads, 0, 'Users without reset_url never request reset details');
    await page.close();
  }
  resetCases.set('native', { reads: 0, posts: [], review: { schema_version: 1, revision: 'n1', title: 'Reset Consent settings', consequences: ['Plugin options are removed.'], preserved: ['Consent content remains.'] } });
  const nativeResetPage = await browser.newPage();
  await nativeResetPage.goto(`${origin}/?view=capability&native-reset=1`);
  await nativeResetPage.locator('#wpsuite-config-reset').getByRole('button', { name: 'Reset settings…', exact: true }).click();
  await nativeResetPage.getByRole('dialog').getByText('Consent content remains.').waitFor();
  await nativeResetPage.getByRole('dialog').getByRole('checkbox').check();
  assert.equal(await nativeResetPage.getByRole('dialog').getByRole('checkbox').evaluate(element => getComputedStyle(element, '::before').content), 'none', 'Native-only reset uses one Mantine checkmark, not a WordPress pseudo-checkbox');
  await expect(nativeResetPage.getByRole('dialog').getByRole('checkbox')).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await nativeResetPage.screenshot({ path: '/tmp/wpsuite-reset-native-confirm.png', fullPage: true, animations: 'disabled' });
  await nativeResetPage.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(resetCases.get('native').posts.length, 0);
  await nativeResetPage.close();
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.addInitScript(() => { window.addEventListener('error', event => console.error('HARNESS', event.message, event.filename, event.lineno)); });
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    const externalRequests = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack ?? error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) {
        externalRequests.push(route.request().url()); return route.abort();
      }
      return route.continue();
    });
    for (const view of ['overview', 'advanced', 'capability', 'malformed']) {
      await page.goto(`${origin}/?view=${view}`);
      await page.waitForLoadState('networkidle');
      assert.deepEqual(errors, [], 'No browser runtime errors');
      if (view === 'overview') {
        assert.equal(await page.getByRole('heading', { name: 'Tools on this site', exact: true }).count(), 1);
        assert.equal(await page.getByRole('heading', { name: 'More tools', exact: true }).count(), 1);
        assert.equal(await page.getByRole('link', { name: 'Install Forms & Workflows', exact: true }).count(), 1);
        assert.deepEqual(await page.getByRole('link', { name: /^Open (Answers|AI Tools)$/ }).evaluateAll(links => links.map(link => link.getAttribute('href'))), bootstrap.capabilities.map(item => item.url));
        assert.doesNotMatch(await page.locator('body').innerText(), /capabilit/i);
      } else if (view === 'advanced') {
        await page.getByText('Platform Settings are available to site administrators.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('link', { name: 'Content library', exact: true }).count(), 0);
      } else if (view === 'capability') {
        assert.equal(await page.getByRole('heading', { name: 'Answers', exact: true }).count(), 1);
        assert.equal(await page.locator('details').count(), 1, 'Legacy capability has one resource section');
        await page.locator('summary').click();
        assert.equal(await page.getByRole('link', { name: 'Content library', exact: true }).count(), 1);
      } else {
        assert.match(await page.locator('body').innerText(), /navigation could not be loaded/);
      }
      assert.equal(await page.getByText('Site connection', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('heading', { name: /site connection/i }).count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px ${view}: horizontal overflow`);
      // The universal PHP header is covered by its own actual markup/browser test.
    }
    await page.goto(`${origin}/?view=overview&statuses=1`);
    await page.getByText('Knowledge sources', { exact: true }).waitFor();
    await page.getByText('Status unavailable', { exact: true }).waitFor();
    assert.equal(await page.getByText('Knowledge sources: 17 · Queued updates: 3', { exact: true }).count(), 1);
    assert.equal(overviewStatus.patches.length, 0, 'Overview status never saves local setup');
    assert.equal(overviewStatus.actions.length, 0, 'Overview status never triggers actions');
    assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).count(), 0, 'Overview never opens the wizard');
    assert.doesNotMatch(await page.locator('body').innerText(), /capabilit/i);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Overview status cards do not overflow');
    await page.screenshot({ path: `/tmp/wpsuite-admin-polish-tools-${width}.png`, fullPage: true, animations: 'disabled' });
    assert.deepEqual(externalRequests, [], 'Non-admin navigation must not request remote configuration');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    await page.close();
  }
  for (const width of [1280, 390]) {
    const scenario = `overview-setup-${width}`;
    const cases = [
      { id: 'answers', label: 'Answers', state: 'ready', configured: false },
      { id: 'ai-editing', label: 'AI Editing', state: 'needs_setup', configured: true },
      { id: 'forms-workflows', label: 'Forms & Workflows', state: 'needs_setup', readonly: true },
      { id: 'login-access', label: 'Login & Access', state: 'unavailable' },
      { id: 'static-publishing', label: 'Static Publishing', state: 'ready', failed: true },
      { id: 'consent', label: 'Consent', state: 'future-unknown' },
      { id: 'content-relations', label: 'Content Relations', state: 'ready', loading: true },
      { id: 'ai-tools', label: 'AI Tools', legacy: true },
    ];
    const cards = cases.map(item => {
      const name = `${scenario}-${item.id}`;
      const entry = fixture(item.configured ?? true);
      entry.surface.status = { state: item.state ?? 'ready', label: item.state === 'needs_setup' ? 'Setup needed' : 'Provider status' };
      entry.surface.can_edit = !item.readonly;
      entry.getError = !!item.failed;
      fixtures.set(name, entry);
      return { ...capability, id: item.id, label: item.label, url: `/?tool=${item.id}`, surface_url: item.legacy ? undefined : `/surface/${name}` };
    });
    overviewCases.set(scenario, cards);
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    let releaseLoading;
    const loadingGate = new Promise(resolve => { releaseLoading = resolve; });
    await page.route(`**/surface/${scenario}-content-relations`, async route => { await loadingGate; await route.continue(); });
    try {
      await page.goto(`${origin}/?view=overview&overview-case=${scenario}`);
      const card = label => page.locator('.mantine-Card-root').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
      const setupCard = card('AI Editing');
      const readyCard = card('Answers');
      await setupCard.getByRole('link', { name: 'Set up AI Editing', exact: true }).waitFor();
      await readyCard.getByText('Provider status', { exact: true }).waitFor();
      await card('Static Publishing').getByText('Status unavailable', { exact: true }).waitFor();
      await card('Consent').getByText('Status unavailable', { exact: true }).waitFor();
      assert.equal(await setupCard.getByText('Setup needed', { exact: true }).count(), 1, 'One clear setup badge, not repeated text.');
      assert.equal(await readyCard.getByText('Setup needed', { exact: true }).count(), 0, 'Provider state overrides configured=false.');
      assert.equal(await readyCard.getByRole('link', { name: 'Open Answers', exact: true }).count(), 1);
      assert.equal(await card('Forms & Workflows').getByText('Setup needed', { exact: true }).count(), 1);
      assert.equal(await card('Forms & Workflows').getByRole('link', { name: 'Open Forms & Workflows', exact: true }).count(), 1, 'Read-only admins do not receive a setup CTA.');
      for (const [label, action] of [
        ['Login & Access', 'Manage Login & Access'], ['Static Publishing', 'Open Static Publishing'],
        ['Consent', 'Manage Consent'], ['Content Relations', 'Manage Content Relations'], ['AI Tools', 'Open AI Tools'],
      ]) {
        assert.equal(await card(label).getByRole('link', { name: action, exact: true }).count(), 1);
        assert.equal(await card(label).getByText('Setup needed', { exact: true }).count(), 0, `${label}: no inferred setup state.`);
      }
      await card('Content Relations').getByText('Checking status…', { exact: true }).waitFor();
      const setupColor = await setupCard.getByRole('link', { name: 'Set up AI Editing', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor);
      const readyColor = await readyCard.getByRole('link', { name: 'Open Answers', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor);
      assert.notEqual(setupColor, readyColor, 'Setup CTA has a visibly distinct background.');
      const badgeColor = await setupCard.locator('.mantine-Badge-root').evaluate(el => getComputedStyle(el).backgroundColor);
      assert.notEqual(badgeColor, 'rgba(0, 0, 0, 0)', 'Setup badge has an actual colored background.');
      for (const element of [setupCard.getByRole('link', { name: 'Set up AI Editing', exact: true }), setupCard.locator('.mantine-Badge-root')]) {
        const contrast = await element.evaluate(el => {
          const rgb = value => {
            // Canvas resolves light-dark()/color() to concrete sRGB before measuring.
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            context.fillStyle = value; context.fillRect(0, 0, 1, 1);
            const rgba = [...context.getImageData(0, 0, 1, 1).data];
            return [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255];
          };
          const composite = (foreground, background) => foreground.slice(0, 3).map((value, index) => value * foreground[3] + background[index] * (1 - foreground[3]));
          const luminance = color => color.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
          const style = getComputedStyle(el);
          const background = composite(rgb(style.backgroundColor), [1, 1, 1]);
          const foreground = composite(rgb(style.color), background);
          const light = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
          return (light[1] + 0.05) / (light[0] + 0.05);
        });
        assert.ok(contrast >= 4.5, `Setup text has readable contrast (${contrast.toFixed(2)}:1).`);
      }

      assert.equal(await setupCard.getByRole('link', { name: 'Set up AI Editing', exact: true }).getAttribute('href'), '/?tool=ai-editing');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Setup labels and status cards do not overflow.');
      await page.screenshot({ path: `/tmp/wpsuite-setup-badge-overview-${width}.png`, fullPage: true, animations: 'disabled' });
      releaseLoading();
      await card('Content Relations').getByText('Provider status', { exact: true }).waitFor();
      for (const item of cases.filter(item => !item.legacy)) {
        const entry = fixtures.get(`${scenario}-${item.id}`);
        assert.equal(entry.reads, 1, `${item.label}: status and CTA share one request.`);
        assert.equal(entry.patches.length, 0);
        assert.equal(entry.actions.length, 0);
      }
    } finally { releaseLoading(); await page.close(); }
  }
  for (const width of [1280, 390]) {
    const name = `custom-setup-${width}`;
    const cases = [
      { id: 'answers', label: 'Answers', can_edit: false, can_setup: true, state: 'needs_setup', action: 'Set up Answers' },
      { id: 'forms-workflows', label: 'Forms & Workflows', can_edit: false, can_setup: false, state: 'needs_setup', action: 'Open Forms & Workflows' },
      { id: 'ai-editing', label: 'AI Editing', can_edit: true, can_setup: false, state: 'needs_setup', action: 'Open AI Editing' },
      { id: 'static-publishing', label: 'Static Publishing', can_edit: false, can_setup: true, state: 'unavailable', action: 'Open Static Publishing' },
    ];
    overviewCases.set(name, cases.map(item => {
      const entry = fixture(false);
      entry.surface.can_edit = item.can_edit; entry.surface.can_setup = item.can_setup;
      entry.surface.status = { state: item.state, label: item.state === 'needs_setup' ? 'Setup needed' : 'Unavailable' };
      entry.surface.steps = []; entry.surface.values = {};
      fixtures.set(`${name}-${item.id}`, entry);
      return { ...capability, id: item.id, label: item.label, url: `/?tool=${item.id}&existing=kept#configuration`, surface_url: `/surface/${name}-${item.id}` };
    }));
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    await page.goto(`${origin}/?view=overview&overview-case=${name}`);
    let setupColor;
    for (const item of cases) {
      const card = page.locator('.mantine-Card-root').filter({ has: page.getByRole('heading', { name: item.label, exact: true }) });
      await card.getByText(item.state === 'needs_setup' ? 'Setup needed' : 'Unavailable', { exact: true }).waitFor();
      const action = card.getByRole('link', { name: item.action, exact: true });
      await action.waitFor();
      if (item.id === 'answers') await expect(action).not.toHaveCSS('background-color', 'rgba(34, 139, 230, 0.1)');
      const background = await action.evaluate(element => getComputedStyle(element).backgroundColor);
      if (item.id === 'answers') setupColor = background;
      else assert.notEqual(background, setupColor, `${item.label}: setup requires both permission and needs_setup state`);
      const href = await action.getAttribute('href');
      const destination = new URL(href, origin);
      assert.equal(destination.origin, origin, 'Setup CTA preserves the admin origin');
      assert.equal(destination.pathname, '/');
      assert.equal(destination.searchParams.get('tool'), item.id);
      assert.equal(destination.searchParams.get('existing'), 'kept');
      assert.equal(destination.hash, '#configuration');
      if (item.id === 'answers') assert.equal(destination.searchParams.get('setup'), '1', 'Custom setup CTA explicitly opens its wizard');
      else assert.equal(href, `/?tool=${item.id}&existing=kept#configuration`, 'Read-only and unavailable destinations are unchanged');
      if (item.state === 'unavailable') assert.equal(await card.getByText('Setup needed', { exact: true }).count(), 0);
      assert.equal(fixtures.get(`${name}-${item.id}`).reads, 1);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `/tmp/wpsuite-custom-setup-overview-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.close();
  }
  {
    const name = 'illustrated-answers'; const entry=fixture(true);
    entry.surface.introduction={title:'Getting started with Answers',description:'Current visitor components.',items:[{title:'Chat and search',description:'Choose a component.'}]};
    fixtures.set(name,entry);
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    await page.addInitScript(() => {
      window.smartcloudWpSuiteIllustrations={answers:[{title:'DocSearch example',src:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="lightblue"/></svg>'},{title:'Summarizer example',src:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="lightgreen"/></svg>'}]};
    });
    await page.goto(`${origin}/?view=capability&surface=${name}`);
    await page.getByText('Getting started with Answers',{exact:true}).click();
    const thumb=page.getByRole('button',{name:'Enlarge screenshot: DocSearch example',exact:true});
    await expect(thumb).toBeVisible(); await thumb.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog',{name:'DocSearch example',exact:true})).toBeVisible();
    await page.keyboard.press('Escape'); await expect(thumb).toBeFocused();
    assert.equal(await page.getByRole('region',{name:'Pro information',exact:true}).count(),0);
    await page.close();
  }
  for (const width of [1280, 390]) {
    const name = `wizard-${width}`;
    const entry = fixture(); fixtures.set(name, entry);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(`${origin}/?view=capability&surface=${name}`);
    await page.getByRole('heading', { name: 'Choose a target' }).waitFor();
    assert.equal(await page.getByLabel('Target URL').inputValue(), 'https://original.example.test', 'Incomplete setup still pre-fills canonical values');
    assert.equal(await page.getByText('Sources', { exact: true }).count(), 0, 'Fresh wizard keeps operational metrics out of its way');
    if (width === 390) await page.screenshot({ path: '/tmp/wpsuite-second-pass-mobile-wizard.png', fullPage: true, animations: 'disabled' });
    assert.equal(await page.getByRole('heading', { name: 'Pro configuration' }).count(), 0, 'Optional Pro detail never precedes local onboarding');
    assert.equal(await page.getByRole('region', {name:'Pro information',exact:true}).count(),0,'Answers folds configuration into backend access');
    const backendToggle = page.getByRole('button',{name:'Backend access',exact:true});
    await expect(backendToggle).toHaveAttribute('aria-expanded','false');
    await backendToggle.focus(); await page.keyboard.press('Enter');
    await expect(backendToggle).toHaveAttribute('aria-expanded','true');
    await expect(page.getByRole('link',{name:'Manage site connection',exact:true})).toBeVisible();
    await backendToggle.click();
    await expect(backendToggle).toHaveAttribute('aria-expanded','false');
    await page.addStyleTag({ content: 'input[type=checkbox]{appearance:auto;width:1rem;height:1rem;border:1px solid #8c8f94} button,input,select,textarea{box-sizing:border-box;font:inherit;margin:0}' });
    await page.getByLabel('Target URL').fill('https://new.example.test');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('heading', { name: 'Preferences' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Preferences', 'Next step receives keyboard focus');
    assert.equal(await page.getByLabel('Enable sync').isChecked(), true);
    await page.getByLabel('Page limit').fill('12');
    await page.getByLabel('Enable sync').uncheck();
    await page.getByRole('textbox', { name: 'Layout' }).click();
    await page.getByRole('option', { name: 'Wide', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('heading', { name: 'Review settings' }).waitFor();
    assert.equal(entry.patches.length, 0, 'Next/back never saves');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await page.getByLabel('Page limit').inputValue(), '12');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('button', { name: 'Run setup again', exact: true }).waitFor();
    assert.equal(entry.patches.length, 1);
    assert.equal(await page.getByText('Sources', { exact: true }).count(), 1, 'Saved overview restores operational metrics');
    for (const panel of ['Tool status', 'Settings', 'Actions', 'Advanced settings and resources']) {
      assert.ok(await page.getByRole('region', { name: panel, exact: true }).evaluate(element => parseFloat(getComputedStyle(element).borderTopWidth) > 0), `${panel} is a bordered section`);
    }
    assert.equal(await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('button', { name: 'Run setup again', exact: true }).count(), 1);
    const resources = page.getByRole('region', { name: 'Advanced settings and resources', exact: true });
    assert.equal(await page.locator('details').count(), 1, 'One consolidated footer');
    await resources.locator('summary').click();
    assert.equal(await resources.locator(`a[href="${link.url}"]`).count(), 1, 'Provider/quick/advanced duplicate is rendered once');
    assert.equal(await resources.getByRole('link', { name: 'Detailed chatbot configuration', exact: true }).count(), 1, 'Specific provider label wins');
    assert.equal(await resources.getByRole('link', { name: 'Content library', exact: true }).count(), 1);
    await page.screenshot({ path: `/tmp/wpsuite-admin-polish-configured-${width}.png`, fullPage: true, animations: 'disabled' });
    if (width === 1280) await page.screenshot({ path: '/tmp/wpsuite-second-pass-desktop-configured.png', fullPage: true, animations: 'disabled' });
    assert.deepEqual(entry.patches[0], { revision: 'r1', values: { target: 'https://new.example.test', enabled: false, limit: 12, layout: 'wide' } });
    assert.deepEqual(entry.advanced, { preserved: 'sentinel' });
    assert.ok(entry.reads >= 2, 'Refresh after saving');
    await page.getByRole('button', { name: 'Run setup again', exact: true }).click();
    assert.equal(await page.getByLabel('Target URL').inputValue(), 'https://new.example.test', 'Restart preserves saved values');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(entry.patches.length, 1, 'Cancel does not reset or save');
    await page.getByRole('button', { name: 'Queue publish', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('This queues a full publish.').waitFor();
    assert.equal(entry.actions.length, 0, 'Opening action confirmation does not run the action');
    await dialog.getByLabel('Run title').fill('My release');
    await dialog.getByRole('button', { name: 'Queue publish', exact: true }).click();
    await page.getByText('Publish queued.', { exact: true }).waitFor();
    assert.deepEqual(entry.actions, [{ action: 'publish', input: { title: 'My release' } }]);
    assert.ok(entry.reads >= 3, 'Refresh after action');
    assert.equal(await page.getByRole('link', { name: 'Continue', exact: true }).getAttribute('href'), `${origin}/wp-admin/admin.php?page=publisher`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px surface: no overflow`);
    assert.deepEqual(errors, []); assert.deepEqual(external, [], 'Disconnected local setup never asks for Pro configuration or site connection');
    await page.close();
  }
  for (const width of [1280, 390]) {
    const name = `use-site-${width}`;
    const entry = siteUseFixture(); fixtures.set(name, entry);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?view=capability&surface=${name}`);
    const use = page.getByRole('region', { name: 'Use on this site', exact: true });
    await use.waitFor();
    assert.equal(await use.getByRole('article').count(), 4);
    assert.deepEqual(await use.getByRole('heading', { level: 3 }).allTextContents(), ['Flow Form', 'Flow Modal', 'Gallery', 'Flow Content Root']);
    assert.ok(await use.evaluate(element => parseFloat(getComputedStyle(element).borderTopWidth) > 0), 'Use section is visibly bordered');
    for (const article of await use.getByRole('article').all()) assert.ok(await article.evaluate(element => parseFloat(getComputedStyle(element).borderTopWidth) > 0), 'Each placement card is bordered');
    const form = use.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Flow Form', exact: true }) });
    assert.equal(await form.getByRole('link', { name: 'Open a new page', exact: true }).getAttribute('href'), '/wp-admin/post-new.php?post_type=page');
    assert.equal(await form.getByRole('link', { name: 'Browse pages', exact: true }).getAttribute('href'), '/wp-admin/edit.php');
    assert.equal(await form.getByRole('link', { name: 'Browse pages', exact: true }).evaluate(element => element.tagName), 'A', 'Placement actions are native editor links');
    assert.equal(await form.getByRole('link', { name: 'Duplicate page resource', exact: true }).count(), 0, 'Repeated placement URL is shown once per card');
    assert.equal(await use.getByText('Configured page: /sign-in/', { exact: true }).count(), 1, 'Only provider-supplied optional status is rendered');
    const resources = page.getByRole('region', { name: 'Advanced settings and resources', exact: true });
    await resources.locator('summary').click();
    assert.equal(await resources.getByRole('link', { name: 'Content library', exact: true }).count(), 0, 'Placement destination is excluded from the technical footer');
    assert.equal(await resources.getByRole('link', { name: 'Detailed chatbot configuration', exact: true }).count(), 1, 'Technical configuration remains available');
    const geometry = await use.getByRole('article').evaluateAll(cards => cards.map(card => ({ x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y })));
    if (width === 390) assert.ok(geometry[1].y > geometry[0].y && Math.abs(geometry[1].x - geometry[0].x) < 1, 'Mobile placement cards stack on one rail');
    else assert.ok(Math.abs(geometry[1].y - geometry[0].y) < 1 && geometry[1].x > geometry[0].x, 'Desktop placement cards use two columns');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Placement guidance never overflows');
    await page.screenshot({ path: `/tmp/wpsuite-frontend-use-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Run setup again', exact: true }).click();
    await page.getByRole('heading', { name: 'Choose a target', exact: true }).waitFor();
    assert.equal(await use.count(), 0, 'Wizard hides placement cards while editing');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await use.waitFor();
    assert.equal(entry.patches.length, 0, 'Browsing guidance and cancelling setup saves nothing');
    assert.equal(entry.actions.length, 0, 'Placement links never dispatch provider actions');
    assert.deepEqual(entry.advanced, { preserved: 'sentinel' });
    assert.deepEqual(errors, []);
    await page.close();
    const freshName = `use-site-fresh-${width}`;
    const fresh = siteUseFixture(false); fixtures.set(freshName, fresh);
    const freshPage = await browser.newPage({ viewport: { width, height: 1000 } });
    await freshPage.goto(`${origin}/?view=capability&surface=${freshName}`);
    await freshPage.getByRole('heading', { name: 'Choose a target', exact: true }).waitFor();
    assert.equal(await freshPage.getByRole('region', { name: 'Use on this site', exact: true }).count(), 0, 'First-run wizard stays focused');
    await freshPage.getByRole('button', { name: 'Cancel', exact: true }).click();
    await freshPage.getByRole('region', { name: 'Use on this site', exact: true }).waitFor();
    assert.equal(fresh.patches.length, 0, 'Closing first-run wizard restores guidance without a save');
    await freshPage.close();
  }
  console.log('Use on this site checks passed at 1280px and 390px: bordered cards, native editor anchors, permission-style empty link lists, placement/footer deduplication, responsive columns, wizard hide/restore and zero configuration writes.');
  for (const width of [1280, 390]) {
    const name = `gatey-experience-${width}`;
    const entry = gateyFixture(name); fixtures.set(name, entry);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?view=capability&surface=${name}`);
    await page.getByRole('heading', { name: 'Connect your sign-in service' }).waitFor();
    assert.equal(suggestionRequests.filter(request => request.name === name).length, 0, 'Page lookup stays idle while its field is not mounted');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    const identifier = page.getByRole('textbox', { name: 'Sign-in identifier', exact: true });
    for (let round = 0; round < 3; round++) {
      await identifier.click();
      for (const label of ['Keep current methods', 'Email', 'Username', 'Phone number']) await page.getByRole('option', { name: label, exact: true }).waitFor();
      const chosen = round % 2 ? 'Username' : 'Email';
      await page.getByRole('option', { name: chosen, exact: true }).click();
      await identifier.click(); await page.getByRole('option', { name: chosen, exact: true }).click();
      assert.equal(await identifier.inputValue(), chosen, 'Re-selecting the active option never creates an invalid empty value');
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByRole('heading', { name: 'Review settings' }).waitFor();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      assert.equal(await identifier.inputValue(), chosen, 'Selected identifier survives review/back');
    }
    await identifier.click(); await page.getByRole('option', { name: 'Username', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await identifier.inputValue(), 'Username');
    const path = page.getByRole('textbox', { name: 'Sign-in page path', exact: true });
    const lookups = () => suggestionRequests.filter(request => request.name === name);
    assert.equal(lookups().length, 0, 'Empty path does not fetch suggestions');
    await path.fill(''); await path.pressSequentially('login', { delay: 25 });
    assert.equal(lookups().length, 0, 'Typing is debounced before any lookup');
    await page.getByRole('option', { name: 'Sign in · sign-in · #17', exact: true }).waitFor();
    assert.deepEqual(lookups().map(request => request.query), ['login'], 'Rapid typing performs a single final query');
    if (width === 390) {
      const option = page.getByRole('option', { name: 'Account login · account/sign-in · #24', exact: true });
      assert.ok(await option.isVisible(), 'Mobile suggestions remain visible inside the wizard');
      await option.scrollIntoViewIfNeeded();
      const box = await option.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, 'Dropdown fits mobile viewport');
      assert.ok(await option.evaluate(element => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit !== null && (element === hit || element.contains(hit));
      }), 'Mobile option is not clipped by a wizard ancestor');
      await page.screenshot({ path: '/tmp/wpsuite-gatey-wizard-mobile-suggestions.png', fullPage: true, animations: 'disabled' });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile autocomplete does not create horizontal overflow');
    }
    await path.press('ArrowDown'); await path.press('Enter');
    assert.equal(await path.inputValue(), 'sign-in', 'Keyboard choice stores page slug, not title/ID label');
    await path.fill('account/sign-in');
    await page.getByRole('option', { name: 'Account login · account/sign-in · #24', exact: true }).waitFor();
    await page.getByRole('option', { name: 'Account login · account/sign-in · #24', exact: true }).click();
    assert.equal(await path.inputValue(), 'account/sign-in', 'Nested paths remain intact');
    await path.fill('17');
    await page.getByRole('option', { name: 'Sign in · sign-in · #17', exact: true }).waitFor();
    assert.equal(lookups().at(-1).query, '17', 'Numeric IDs are valid lookup queries');
    await page.getByRole('option', { name: 'Sign in · sign-in · #17', exact: true }).click();
    assert.equal(await path.inputValue(), 'sign-in');
    await path.fill('slow');
    const startedSlow = page.waitForRequest(request => request.url().includes(`/surface/${name}/suggestions`) && new URL(request.url()).searchParams.get('q') === 'slow');
    await startedSlow;
    await path.fill('new');
    await page.getByRole('option', { name: 'Sign in · sign-in · #17', exact: true }).waitFor();
    await new Promise(resolve => setTimeout(resolve, 900));
    assert.equal(await page.getByRole('option', { name: 'Stale result · old-sign-in · #9', exact: true }).count(), 0, 'Late responses cannot replace newer suggestions');
    assert.equal(lookups().find(request => request.query === 'slow')?.aborted, true, 'Stale fetch is aborted');
    await path.fill('error');
    await page.waitForResponse(response => response.url().includes(`/surface/${name}/suggestions`) && new URL(response.url()).searchParams.get('q') === 'error');
    await page.getByText('Page suggestions are unavailable. You can still enter a path.', { exact: true }).waitFor();
    assert.equal(await path.inputValue(), 'error', 'Lookup failures never overwrite typed paths');
    await path.fill('/custom-login/');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('heading', { name: 'Review settings' }).waitFor();
    assert.equal(await page.getByText('/custom-login/', { exact: true }).count(), 1, 'Lookup errors still allow free manual paths');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('button', { name: 'Run setup again', exact: true }).waitFor();
    assert.equal(entry.patches.at(-1).values.signInPage, '/custom-login/');
    assert.equal(entry.patches.at(-1).values.loginMechanism, 'username');
    const afterClose = lookups().length;
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(lookups().length, afterClose, 'Closed wizard does not keep fetching suggestions');
    assert.equal(await page.getByRole('option').count(), 0, 'Closed wizard removes dropdowns');
    assert.deepEqual(errors, [], 'Gatey-style wizard has no runtime errors');
    await page.close();
    const closedName = `gatey-configured-${width}`;
    fixtures.set(closedName, gateyFixture(closedName, true));
    const closedPage = await browser.newPage({ viewport: { width, height: 1000 } });
    await closedPage.goto(`${origin}/?view=capability&surface=${closedName}`);
    await closedPage.getByRole('button', { name: 'Run setup again', exact: true }).waitFor();
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(suggestionRequests.filter(request => request.name === closedName).length, 0, 'Already configured screen never starts lookups');
    await closedPage.close();
    console.log(`Gatey ${width}px wizard checks passed: identifier options and selection through repeated review/back; debounced title/slug/ID suggestions, keyboard slug selection, stale abort, manual path after errors, idle closed wizard and mobile dropdown geometry.`);
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
  const conflict = fixture(); conflict.conflict = true; fixtures.set('conflict', conflict);
  await page.goto(`${origin}/?view=capability&surface=conflict`);
  await page.getByLabel('Target URL').fill('https://unsaved.example.test');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByText('Settings changed in another session', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Save settings', exact: true }).isDisabled());
  assert.match(await page.locator('body').innerText(), /https:\/\/unsaved.example.test/);
  await page.getByRole('button', { name: 'Discard input and reload latest' }).click();
  await page.getByRole('heading', { name: 'Choose a target' }).waitFor();
  assert.equal(await page.getByLabel('Target URL').inputValue(), 'https://concurrent.example.test');
  assert.equal(conflict.patches.length, 1, 'Conflict is never silently retried');

  const actionError = fixture(true); actionError.actionError = true; fixtures.set('action-error', actionError);
  await page.goto(`${origin}/?view=capability&surface=action-error`);
  await page.getByRole('button', { name: 'Queue publish', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Run title').fill('Retry release');
  await page.getByRole('dialog').getByRole('button', { name: 'Queue publish', exact: true }).click();
  await page.getByRole('dialog').getByText('Runner unavailable. Try again.').waitFor();
  assert.equal(await page.getByRole('dialog').getByLabel('Run title').inputValue(), 'Retry release');
  await page.getByRole('dialog').getByRole('button', { name: 'Queue publish', exact: true }).click();
  await page.getByText('Publish queued.', { exact: true }).waitFor();
  assert.equal(actionError.actions.length, 2);

  const malformed = fixture(); malformed.surface.values.target = { unexpected: 'object' }; fixtures.set('bad-surface', malformed);
  await page.goto(`${origin}/?view=capability&surface=bad-surface`);
  await page.getByText(/This tool could not be displayed/).waitFor();
  assert.equal(await page.getByRole('textbox').count(), 0, 'Malformed surface renders no editable controls');
  await page.locator('summary').filter({ hasText: 'Advanced settings' }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('link', { name: 'Shared settings shortcut', exact: true }).count(), 1, 'Advanced destination survives provider failure');
  const unavailable = fixture(); unavailable.getError = true; fixtures.set('unavailable', unavailable);
  await page.goto(`${origin}/?view=capability&surface=unavailable`);
  await page.getByText('The local provider is temporarily unavailable.').waitFor();
  await page.locator('summary').click();
  assert.equal(await page.locator(`a[href="${link.url}"]`).count(), 1, 'Registration fallback is available when GET fails');
  const readonly = fixture(true); readonly.surface.can_edit = false; fixtures.set('readonly', readonly);
  await page.goto(`${origin}/?view=capability&surface=readonly`);
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Run setup again', exact: true }).count(), 0);
  assert.equal(await page.getByRole('textbox').count(), 0);
  await page.close();
  // Context help opens the requested topic without submitting, toggling or losing draft data.
  for (const width of [1280, 390]) {
    const name = `help-${width}`, entry = fixture(true); fixtures.set(name, entry);
    entry.surface.help = [
      { id: 'target-help', title: 'Target address', summary: 'Choose the visitor-facing address.', paragraphs: ['This value changes generated links, not the WordPress admin address.'] },
      { id: 'sync-help', title: 'Synchronization', summary: 'Queue updates when content changes.', paragraphs: ['The preference does not verify a remote service.'] },
    ];
    entry.surface.steps[0].fields[0].help_id = 'target-help';
    entry.surface.steps[0].fields[0].description = 'The public address visitors will use.';
    entry.surface.steps[1].fields[0].help_id = 'sync-help';
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?view=capability&surface=${name}`);
    const settings = page.getByRole('region', { name: 'Settings', exact: true });
    await settings.waitFor();
    const columns = await settings.locator('section').evaluateAll(items => items.map(item => ({ x: item.getBoundingClientRect().x, y: item.getBoundingClientRect().y })));
    assert.equal(columns.length, 2);
    if (width === 390) assert.ok(columns[1].y > columns[0].y && Math.abs(columns[1].x - columns[0].x) < 1);
    else assert.ok(Math.abs(columns[1].y - columns[0].y) < 1 && columns[1].x > columns[0].x);
    await page.getByRole('button', { name: 'Run setup again', exact: true }).click();
    await page.getByRole('textbox', { name: /Target URL/ }).fill('https://draft.example.test');
    const help = page.getByRole('button', { name: 'Help: Target URL', exact: true });
    await page.getByText('The public address visitors will use.', { exact: true }).waitFor();
    const geometry = await page.getByRole('textbox', {name:/Target URL/}).evaluate(input => {
      const label = document.querySelector(`label[for="${input.id}"]`);
      const star = label.querySelector('.mantine-InputWrapper-required').getBoundingClientRect();
      const text = label.firstElementChild.getBoundingClientRect();
      const button = [...document.querySelectorAll('button.mantine-Button-root')].find(el => el.textContent === 'Next');
      const outer = button.getBoundingClientRect(), inner = button.querySelector('.mantine-Button-label').getBoundingClientRect();
      return { starTop:star.top, textBottom:text.bottom, buttonOffset:Math.abs((outer.top+outer.bottom-inner.top-inner.bottom)/2) };
    });
    assert.ok(geometry.starTop < geometry.textBottom, 'Required marker stays beside the InfoLabel');
    assert.ok(geometry.buttonOffset < 2, `Button label centered: ${geometry.buttonOffset}`);
    await page.evaluate(() => { window.helpScrollCalls=[]; const original=Element.prototype.scrollIntoView; Element.prototype.scrollIntoView=function(options){if(this.hasAttribute('data-help-topic'))window.helpScrollCalls.push(options);return original.call(this,options);}; });
    await help.focus(); await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Tool help' });
    await drawer.waitFor();
    await drawer.getByRole('heading', { name: 'Target address', exact: true }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Target address');
    assert.equal(await drawer.locator('[data-help-topic=target-help]').evaluate(el=>getComputedStyle(el).backgroundColor), 'rgb(255, 241, 168)');
    assert.equal(await page.evaluate(()=>window.helpScrollCalls.at(-1)?.behavior), 'smooth');
    await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('textbox', { name: /Target URL/ }).inputValue(), 'https://draft.example.test');
    assert.equal(await help.evaluate(element => element === document.activeElement), true, 'Closing help restores trigger focus');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: /Enable sync/ }).isChecked(), true);
    await page.getByRole('button', { name: 'Help: Enable sync', exact: true }).click();
    await drawer.waitFor(); await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('checkbox', { name: /Enable sync/ }).isChecked(), true, 'InfoLabel inside checkbox label does not toggle value');
    assert.equal(entry.patches.length, 0); assert.equal(entry.actions.length, 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `/tmp/wpsuite-capability-v2-gates/help-wizard-${width}.png`, fullPage: true });
    await page.close();
  }
  // A Select inside the action modal must escape its scroll/clipping container.
  for (const width of [1280, 390]) {
    const name = `preset-modal-${width}`, entry = fixture(true);
    entry.surface.steps = []; entry.surface.values = {};
    entry.surface.actions = [{ id: 'start-from-preset', label: 'Start from a preset', fields: [{ id: 'preset', label: 'Preset', type: 'select', required: true, options: [
      {value:'universal',label:'Universal Gutenberg'}, {value:'recommended',label:'SmartCloud Recommended'}, {value:'theme',label:'Detected Theme Starter'},
    ] }] }];
    fixtures.set(name, entry);
    const page = await browser.newPage({ viewport: { width, height: 700 } });
    await page.goto(`${origin}/?view=capability&surface=${name}`);
    await page.getByRole('button', {name:'Start from a preset',exact:true}).click();
    const dialog = page.getByRole('dialog', {name:'Start from a preset'});
    await dialog.getByRole('textbox', {name:'Preset',exact:true}).click();
    await page.getByRole('option', {name:'Universal Gutenberg',exact:true}).waitFor();
    const visible = await page.getByRole('option').evaluateAll(options => options.map(el => {
      const rect=el.getBoundingClientRect();
      const top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
      return rect.top>=0 && rect.bottom<=innerHeight && !!top && (top===el || el.contains(top));
    }));
    assert.deepEqual(visible,[true,true,true], 'All preset options are unobscured and within the viewport');
    await page.getByRole('option', {name:'Universal Gutenberg',exact:true}).click();
    await expect(dialog.getByRole('textbox', {name:'Preset',exact:true})).toHaveValue('Universal Gutenberg');
    assert.equal(entry.actions.length,0,'Selecting a preset does not create a config');
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(entry.actions.length,0,'Cancel leaves configurations unchanged');
    await page.close();
  }
  const configuredEditing = fixture(true);
  configuredEditing.surface.steps = []; configuredEditing.surface.values = {};
  configuredEditing.surface.primary_link = { label: 'Edit in Advanced', url: link.url };
  configuredEditing.surface.actions = [{ id: 'rescan-site', label: 'Rescan site', fields: [] }];
  fixtures.set('editing-configured', configuredEditing);
  const editingPage = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await editingPage.goto(`${origin}/?view=capability&surface=editing-configured`);
  const editingStatus = editingPage.getByRole('region', { name: 'Tool status', exact: true });
  await editingStatus.getByRole('link', { name: 'Edit in Advanced', exact: true }).waitFor();
  assert.equal(await editingStatus.getByRole('button', { name: 'Rescan site', exact: true }).count(), 1);
  assert.equal(await editingPage.getByRole('region', { name: 'Actions', exact: true }).count(), 0, 'Configured editing has one compact command row, no old action panel');
  assert.equal(await editingPage.getByRole('region', { name: 'Settings', exact: true }).count(), 0, 'No working-copy settings block when configuration exists');
  assert.equal(await editingPage.getByRole('button', { name: /setup|Validate draft|Activate configuration|Start from a preset/i }).count(), 0);
  await editingPage.locator('summary').click();
  assert.equal(await editingPage.locator(`a[href="${link.url}"]`).count(), 1, 'Promoted Advanced destination is not repeated in footer');
  assert.equal(configuredEditing.patches.length, 0); assert.equal(configuredEditing.actions.length, 0);
  assert.ok(await editingPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await editingPage.close();
  const extensionEntry = fixture(true); fixtures.set('extension', extensionEntry);
  const extensionPage = await browser.newPage();
  await extensionPage.goto(`${origin}/?view=capability&surface=extension&extension=fixture`);
  await extensionPage.getByText('Loading tools…', { exact: true }).waitFor();
  await extensionPage.evaluate(() => {
    window.mountCount = 0; window.cleanupCount = 0;
    window.smartcloudWpSuiteSurfaces = { fixture: (element, context) => {
      window.mountCount++; const button = document.createElement('button'); button.textContent = 'Extension help';
      button.onclick = () => context.openHelp('status'); element.append(button);
      return () => { window.cleanupCount++; element.replaceChildren(); };
    } };
    window.dispatchEvent(new Event('smartcloud-wpsuite-surface-ready'));
    window.dispatchEvent(new Event('smartcloud-wpsuite-surface-ready'));
  });
  await extensionPage.getByRole('button', { name: 'Extension help' }).click();
  await extensionPage.getByRole('dialog', { name: 'Tool help' }).waitFor();
  await extensionPage.keyboard.press('Escape');
  assert.equal(await extensionPage.evaluate(() => window.mountCount), 1, 'Late extension mounts once despite repeated ready events');
  await extensionPage.getByRole('button', { name: 'Run setup again', exact: true }).click();
  assert.equal(await extensionPage.evaluate(() => window.cleanupCount), 1, 'Hiding an extension cleans up its root');
  await extensionPage.close();
  for (const width of [1280, 390]) {
    const name = `integrated-${width}`;
    fixtures.set(name, fixture(true));
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/?view=capability&surface=${name}&integrated=1`);
    await page.getByRole('button', { name: 'Run setup again', exact: true }).waitFor();
    assert.equal(await page.locator('#wpsuite-product-details').isVisible(), false);
    assert.equal(await page.locator('summary').count(), 0, 'No duplicate Advanced resource list in unified product');
    await expect(page.getByRole('region', { name: 'Tool status', exact: true }).getByRole('button', { name: 'Backend access', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Advanced settings and resources', exact: true }).click();
    await page.locator('#native-draft').fill('unsaved native draft');
    await expect(page.getByRole('button', { name: 'Backend access', exact: true })).toHaveAttribute('aria-expanded', 'false');
    assert.equal(await page.locator('#wpsuite-product-summary').getByRole('button', { name: 'Backend access', exact: true }).count(), 0, 'Details view retains exactly one backend check outside folded summary');
    assert.equal(await page.locator('#wpsuite-product-summary').isVisible(), false);
    assert.equal(new URL(page.url()).searchParams.get('panel'), 'details');
    await page.getByRole('button', { name: 'Show setup and status', exact: true }).click();
    await page.getByRole('button', { name: 'Run setup again', exact: true }).click();
    await page.getByRole('textbox', { name: 'Target URL', exact: true }).fill('https://staged.example');
    await page.getByRole('button', { name: 'Advanced settings and resources', exact: true }).click();
    assert.equal(await page.locator('#native-draft').inputValue(), 'unsaved native draft');
    await page.goBack();
    await page.getByRole('textbox', { name: 'Target URL', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Target URL', exact: true }).inputValue(), 'https://staged.example');
    assert.equal(fixtures.get(name).patches.length, 0, 'Switching panels does not save');
    await page.goto(`${origin}/?view=capability&surface=${name}&integrated=1&section=configuration`);
    await page.locator('#native-draft').waitFor();
    assert.equal(await page.locator('#wpsuite-product-summary').isVisible(), false, 'Deep links open native details directly');
    fixtures.get(name).surface.values.target = 'https://fresh-saved.example';
    await page.getByRole('button', { name: 'Show setup and status', exact: true }).click();
    await page.getByText('https://fresh-saved.example', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Run setup again', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Target URL', exact: true }).inputValue(), 'https://fresh-saved.example', 'Replay reflects edits saved in detailed admin');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Advanced settings and resources', exact: true }).click();
    await page.locator('#native-draft').fill('advanced change to keep');
    await page.getByRole('button', { name: 'Show setup and status', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('wpsuite-product-saved')));
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Advanced settings and resources', exact: true }).click();
    assert.equal(await page.locator('#native-draft').inputValue(), 'advanced change to keep', 'Declining reload preserves staged native edits');
    assert.equal(new URL(page.url()).searchParams.get('panel'), 'summary');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Advanced settings and resources', exact: true }).click();
    await page.locator('#native-draft').waitFor();
    assert.equal(await page.locator('#native-draft').inputValue(), 'original', 'Confirmed reload rehydrates canonical details');
    await page.getByRole('button', { name: 'Show setup and status', exact: true }).click();
    await page.evaluate(() => { window.rehydrationSentinel = true; window.dispatchEvent(new Event('wpsuite-product-saved')); });
    await page.goBack();
    await page.locator('#native-draft').waitFor();
    assert.equal(await page.evaluate(() => window.rehydrationSentinel), undefined, 'Back after summary save rehydrates native settings too');
    await page.close();
  }
  const skeletonPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await skeletonPage.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await skeletonPage.goto(`${origin}/?view=overview&admin=1&connected=1`);
  const skeleton = skeletonPage.getByRole('region', { name: 'Site connection', exact: true }).locator('.mantine-Skeleton-root');
  await skeleton.waitFor();
  const skeletonBox = await skeleton.boundingBox();
  assert.ok(skeletonBox.height >= 75 && skeletonBox.height <= 85, 'Connected Overview uses a compact 80px loading placeholder');
  await skeletonPage.close();
  const adminPage = await browser.newPage({ viewport: { width: 390, height: 1000 } });
  const adminErrors = [];
  adminPage.on('pageerror', error => adminErrors.push(error.message));
  await adminPage.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.hostname === 'wpsuite.io' && url.pathname.includes('/static/config/')) return route.fulfill({ json: {
      config: 'fixture', baseUrl: 'https://wpsuite.io', userPoolId: 'eu-central-1_ABC123', appClientPlugin: 'fixtureclient',
      identityPoolId: 'eu-central-1:00000000-0000-0000-0000-000000000000', awsRegion: 'eu-central-1', permissions: {},
    } });
    return route.abort();
  });
  await adminPage.goto(`${origin}/?view=overview&admin=1`);
  const connection = adminPage.getByRole('heading', { name: 'WP Suite site connection', exact: true });
  await connection.waitFor();
  await adminPage.getByText("Connect this site to manage Pro configuration. Other tools work without a connection.", { exact: true }).waitFor();
  assert.equal(await adminPage.getByText(/preview and try Pro features in WP Admin/).count(), 0, "Embedded connection omits the standalone marketing introduction");
  const connectionBox = await connection.boundingBox();
  const capabilitiesBox = await adminPage.getByRole('heading', { name: 'Tools on this site', exact: true }).boundingBox();
  assert.ok(connectionBox && capabilitiesBox && connectionBox.y < capabilitiesBox.y, 'Existing connection flow appears prominently above capabilities');
  assert.equal(await adminPage.getByRole('link', { name: 'Platform Settings', exact: true }).count(), 1);
  assert.equal(await adminPage.getByRole('region', { name: 'Site connection', exact: true }).locator(':scope > div').evaluate(element => getComputedStyle(element).padding), '0px', 'Embedded Main does not add a second padding rail');
  await adminPage.waitForLoadState('networkidle');
  await adminPage.getByText('Not connected. Connect this site to view its workspace and subscription.', { exact: true }).waitFor();
  assert.equal(await adminPage.getByText('Loading site…', { exact: true }).count(), 0, 'A disabled site query on a fresh installation is not displayed as loading');
  await adminPage.getByRole('button', { name: 'Sign In and Connect Your Site', exact: true }).waitFor();
  await adminPage.screenshot({ path: '/tmp/wpsuite-second-pass-mobile-overview.png', fullPage: true, animations: 'disabled' });
  assert.deepEqual(adminErrors, []);
  await adminPage.goto(`${origin}/?view=advanced&admin=1`);
  await adminPage.getByRole('tab', { name: 'reCAPTCHA Settings', exact: true }).waitFor();
  assert.equal(await adminPage.getByRole('tab', { name: 'reCAPTCHA Settings' }).getAttribute('aria-selected'), 'true');
  await adminPage.getByRole('tab', { name: 'Styling', exact: true }).click();
  assert.equal(new URL(adminPage.url()).searchParams.get('section'), 'styling');
  await adminPage.getByRole('textbox', { name: 'Additional stylesheet URLs', exact: true }).fill('/my-staged.css');
  await adminPage.getByRole('tab', { name: 'Translations', exact: true }).click();
  await adminPage.goBack();
  await adminPage.getByRole('textbox', { name: 'Additional stylesheet URLs', exact: true }).waitFor();
  assert.equal(await adminPage.getByRole('textbox', { name: 'Additional stylesheet URLs', exact: true }).inputValue(), '/my-staged.css', 'Platform tab/history navigation preserves edits');
  assert.equal(await adminPage.getByRole('link', { name: 'Content library', exact: true }).count(), 0, 'Platform Settings is not a plugin directory');
  assert.ok(await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile Platform tabs do not overflow');
  await adminPage.close();
  assert.ok(requests.every(request => request.nonce === 'surface-nonce'), 'All local REST requests send the WordPress nonce');
  assert.ok(requests.every(request => request.path.startsWith('/surface/')), 'No product Pro write endpoint used');
  console.log('Navigation browser checks passed: Overview connection placement, platform links, capability CTAs; mobile/desktop wizard prefill, review/save, cancel/restart, nonce patches, status refresh, action confirmation/input/retry, conflicts, malformed/unavailable/read-only providers, disconnected local use, optional Pro detail, baseline navigation, keyboard and overflow.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
