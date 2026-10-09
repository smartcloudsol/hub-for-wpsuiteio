import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundled = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { MantineProvider } from '@mantine/core';
    import BackendReadiness from './src/backend-readiness';
    import SetupIntroduction from './src/setup-introduction';
    const root = createRoot(document.getElementById('root'));
    window.mount = (id = 'answers', compact = false, detailed = false) => root.render(<MantineProvider><BackendReadiness id={id} compact={compact} detailed={detailed} /></MantineProvider>);
    window.unmount = () => root.render(null);
    window.introduction = (configured = false) => root.render(<SetupIntroduction endpoint="/flow" defaultOpen={!configured}><summary>Getting started with Forms &amp; Workflows</summary><p>Introduction content</p></SetupIntroduction>);
  ` },
  bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'fixtures', setup(builder) {
    builder.onResolve({ filter: /^(@smart-cloud\/wpsuite-core|@wordpress\/i18n)$/ }, args => ({ path: args.path, namespace: 'fixtures' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixtures' }, ({ path }) => ({ contents: path.includes('wpsuite-core') ? 'export const getWpSuite = () => window.wpSuite; export const TEXT_DOMAIN = "test";' : 'export const __ = value => value;' }));
  } }],
});
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundled.outputFiles[0].text); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end('<div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const base = `http://127.0.0.1:${server.address().port}`;
let checks = 0;
async function scenario(run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${base}/nested/wp-admin/admin.php?page=capability`);
    await page.evaluate(() => { window.wpSuite = { siteSettings: { accountId: 'account', siteId: 'site', siteKey: 'key' } }; window.calls = 0; window.aborts = 0; });
    await run(page);
    checks++;
  } finally { await context.close(); }
}
try {
  await scenario(async page => {
    await page.evaluate(() => { window.wpSuite.siteSettings = {}; window.smartcloudWpSuiteBackendChecks = { answers: async () => { window.calls++; return 'ready'; } }; window.mount(); });
    await expect(page.getByText('Connect this site', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.calls), 0);
    await expect(page.getByRole('link', { name: 'Manage site connection' })).toHaveAttribute('href', `${base}/nested/wp-admin/admin.php?page=smartcloud-wpsuite`);
  });
  for (const [state, label] of Object.entries({
    ready: 'Backend administration access verified', configure_backend: 'Configure your backend',
    sign_in: "Sign in to your site's Cognito user pool", gatey_missing: 'Gatey is required for backend sign-in',
    forbidden: 'Backend access was denied', unreachable: 'Backend access could not be verified', unsupported: 'Backend access check is unavailable',
  })) await scenario(async page => {
    await page.evaluate(state => { window.smartcloudWpSuiteBackendChecks = { answers: async () => state }; window.mount(); }, state);
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    if (state === 'sign_in') {
      await expect(page.getByRole('link', { name: 'Open WordPress Login in Gatey' })).toHaveAttribute('href', `${base}/nested/wp-admin/admin.php?page=gatey&section=wordpress-login`);
      await expect(page.getByText(/map the pool's administrator group/)).toBeVisible();
    }
    if (state === 'gatey_missing') assert.equal(await page.locator('a[href*="page=gatey"]').count(), 0);
    if (state === 'ready') await expect(page.getByText(/workflow execution have not been checked/)).toBeVisible();
  });
  await scenario(async page => {
    await page.evaluate(() => { window.mount('forms-workflows'); });
    await expect(page.getByText('Checking backend access…')).toBeVisible();
    await page.evaluate(() => { window.smartcloudWpSuiteBackendChecks = { 'forms-workflows': async () => 'configure_backend' }; window.dispatchEvent(new Event('smartcloud-wpsuite-backend-ready')); });
    await expect(page.getByRole('link', { name: 'Open API settings' })).toHaveAttribute('href', `${base}/nested/wp-admin/admin.php?page=smartcloud-flow&section=api-settings`);
  });
  await scenario(async page => {
    await page.clock.install();
    await page.evaluate(() => window.mount());
    await expect(page.getByText('Checking backend access…')).toBeVisible();
    await page.clock.fastForward(10001);
    await expect(page.getByText('Backend access check is unavailable')).toBeVisible();
  });
  await scenario(async page => {
    await page.clock.install();
    await page.evaluate(() => { window.smartcloudWpSuiteBackendChecks = { answers: signal => new Promise(resolve => { window.resolveProbe = resolve; signal.addEventListener('abort', () => window.aborts++); }) }; window.mount(); });
    await expect(page.getByText('Checking backend access…')).toBeVisible();
    await page.clock.fastForward(15001);
    await expect(page.getByText('Backend access could not be verified')).toBeVisible();
    assert.equal(await page.evaluate(() => window.aborts), 1);
    await page.evaluate(() => window.resolveProbe('ready'));
    await expect(page.getByText('Backend access could not be verified')).toBeVisible();
  });
  await scenario(async page => {
    await page.evaluate(() => { window.smartcloudWpSuiteBackendChecks = { answers: signal => { window.calls++; if (window.calls > 1) return Promise.resolve('forbidden'); return new Promise(resolve => { window.resolveProbe = resolve; signal.addEventListener('abort', () => window.aborts++); }); } }; window.mount(); });
    await page.getByRole('button', { name: 'Restart check' }).click();
    await expect(page.getByText('Backend access was denied')).toBeVisible();
    await page.evaluate(() => window.resolveProbe('ready'));
    await expect(page.getByText('Backend access was denied')).toBeVisible();
    assert.equal(await page.evaluate(() => window.aborts), 1);
  });
  await scenario(async page => {
    await page.evaluate(() => { window.smartcloudWpSuiteBackendChecks = { answers: signal => new Promise(() => signal.addEventListener('abort', () => window.aborts++)) }; window.mount(); });
    await expect(page.getByText('Checking backend access…')).toBeVisible();
    await page.evaluate(() => window.unmount());
    assert.equal(await page.evaluate(() => window.aborts), 1);
  });
  await scenario(async page => {
    await page.clock.install();
    await page.evaluate(() => { window.smartcloudWpSuiteBackendChecks = { answers: async () => { window.calls++; return 'ready'; } }; window.mount(); });
    await expect(page.getByText('Backend administration access verified')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.evaluate(() => window.calls), 1);
    await page.clock.fastForward(30001);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.evaluate(() => window.calls), 1);
    await page.evaluate(() => window.dispatchEvent(new Event('wpsuite-product-summary-open')));
    assert.equal(await page.evaluate(() => window.calls), 1);
    await page.evaluate(() => window.dispatchEvent(new Event('wpsuite-backend-session-changed')));
    await expect.poll(() => page.evaluate(() => window.calls)).toBe(2);
  });
  await scenario(async page => {
    await page.evaluate(() => { window.smartcloudWpSuiteBackendChecks = { answers: async () => { throw new Error('PRIVATE_PAYLOAD_MUST_NOT_RENDER'); } }; window.mount(); });
    await expect(page.getByText('Backend access could not be verified')).toBeVisible();
    assert.equal(await page.getByText('PRIVATE_PAYLOAD_MUST_NOT_RENDER').count(), 0);
  });
  await scenario(async page => {
    await page.evaluate(() => { window.smartcloudWpSuiteBackendChecks = { answers: async () => 'sign_in' }; window.mount('answers', true); });
    const toggle = page.getByRole('button', { name: 'Backend access', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Sign-in needed', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open WordPress Login in Gatey' })).not.toBeVisible();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: 'Open WordPress Login in Gatey' })).toBeVisible();
    await expect(page.getByText(/Your WP Suite sign-in is a separate session/)).toBeVisible();
    assert.equal(await page.getByRole('heading', { name: 'Backend access' }).count(), 0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Sign-in needed', { exact: true })).toBeVisible();
  });
  await scenario(async page => {
    await page.evaluate(() => {
      window.authListeners = new Set(); window.authUnsubscribed = 0;
      window.WpSuiteAmplify = { Hub: { listen(channel, callback) {
        if (channel !== 'auth') throw new Error('Unexpected channel');
        window.authListeners.add(callback);
        return () => { window.authListeners.delete(callback); window.authUnsubscribed++; };
      } } };
      window.sendAuth = event => window.authListeners.forEach(callback => callback({ payload: { event } }));
      window.smartcloudWpSuiteBackendChecks = { answers: async () => { window.calls++; return 'ready'; } }; window.mount();
    });
    await expect(page.getByText('Backend administration access verified')).toBeVisible();
    for (const [event, expected] of [['signedIn', 2], ['signedOut', 3], ['tokenRefresh_failure', 4]]) {
      await page.evaluate(event => window.sendAuth(event), event);
      await expect.poll(() => page.evaluate(() => window.calls)).toBe(expected);
    }
    await page.evaluate(() => { window.sendAuth('tokenRefresh_failure'); window.sendAuth('tokenRefresh'); });
    assert.equal(await page.evaluate(() => window.calls), 4);
    await page.evaluate(() => window.sendAuth('signedIn'));
    await expect.poll(() => page.evaluate(() => window.calls)).toBe(5);
    await page.evaluate(() => window.sendAuth('tokenRefresh_failure'));
    await expect.poll(() => page.evaluate(() => window.calls)).toBe(6);
    await page.evaluate(() => window.unmount());
    // The cache listener remains active on admin pages without a visible panel.
    assert.equal(await page.evaluate(() => window.authUnsubscribed), 0);
    assert.equal(await page.evaluate(() => window.authListeners.size), 1);
    await page.evaluate(() => window.sendAuth('signedOut'));
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('wpsuite-backend-access:')).length), 0);
  });
  await scenario(async page => {
    await page.evaluate(() => { window.smartcloudWpSuiteBackendChecks = { answers: async () => { window.calls++; return 'ready'; } }; window.mount(); });
    await expect(page.getByText('Backend administration access verified')).toBeVisible();
    await page.evaluate(() => {
      window.WpSuiteAmplify = { Hub: { listen(_channel, callback) { window.lateAuth = callback; return () => {}; } } };
      window.dispatchEvent(new Event('focus'));
      window.lateAuth({ payload: { event: 'signedIn' } });
    });
    await expect.poll(() => page.evaluate(() => window.calls)).toBe(2);
  });
  await scenario(async page => {
    await page.clock.install();
    await page.evaluate(() => { window.smartcloudWpSuiteBackendChecks = { answers: async () => { window.calls++; return 'ready'; } }; window.mount(); });
    await expect(page.getByText('Backend administration access verified')).toBeVisible();
    await page.evaluate(() => window.unmount());
    await page.evaluate(() => window.mount());
    await expect(page.getByText('Backend administration access verified')).toBeVisible();
    assert.equal(await page.evaluate(() => window.calls), 1, 'Remount reuses fresh result');
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(key => key.startsWith('wpsuite-backend-access:')))));
    assert.deepEqual(Object.keys(stored).sort(), ['state', 'time']);
    await page.clock.fastForward(300001);
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('wpsuite-product-summary-open')); });
    assert.equal(await page.evaluate(() => window.calls), 1, 'No focus or summary-open probe even after expiry');
    await page.evaluate(() => window.unmount());
    await page.evaluate(() => window.mount());
    await expect.poll(() => page.evaluate(() => window.calls)).toBe(2);
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect.poll(() => page.evaluate(() => window.calls)).toBe(3);
  });
  await scenario(async page => {
    async function initialize() {
      await page.evaluate(() => { window.wpSuite = { siteSettings: { accountId: 'account', siteId: 'site', siteKey: 'key' } }; window.calls = 0; window.smartcloudWpSuiteBackendChecks = { answers: async () => { window.calls++; return 'ready'; } }; window.mount(); });
      await expect(page.getByText('Backend administration access verified')).toBeVisible();
    }
    await initialize();
    assert.equal(await page.evaluate(() => window.calls), 1);
    await page.reload();
    await initialize();
    assert.equal(await page.evaluate(() => window.calls), 0, 'Page navigation reuses tab cache');
    for (const [field, value] of [['siteId', 'other-site'], ['accountId', 'other-account'], ['lastUpdate', 99]]) {
      await page.evaluate(() => window.unmount());
      await page.evaluate(({field, value}) => { window.wpSuite.siteSettings[field] = value; window.mount(); }, {field, value});
      await expect(page.getByText('Backend administration access verified')).toBeVisible();
    }
    assert.equal(await page.evaluate(() => window.calls), 3, 'Connection identity/configuration scopes cached results');
    await page.evaluate(() => window.unmount());
    await page.evaluate(() => { window.smartcloudWpSuiteBackendChecks['forms-workflows'] = async () => { window.calls++; return 'forbidden'; }; window.mount('forms-workflows'); });
    await expect(page.getByText('Backend access was denied')).toBeVisible();
    assert.equal(await page.evaluate(() => window.calls), 4, 'Each backend has its own cache');
  });
  await scenario(async page => {
    await page.evaluate(() => { Storage.prototype.getItem = () => { throw new Error('blocked'); }; Storage.prototype.setItem = () => { throw new Error('blocked'); }; window.smartcloudWpSuiteBackendChecks = { answers: async () => 'ready' }; window.mount(); });
    await expect(page.getByText('Backend administration access verified')).toBeVisible();
  });
  await scenario(async page => {
    await page.evaluate(() => window.introduction());
    const disclosure = page.locator('details');
    await expect(disclosure).toHaveAttribute('open', '');
    await page.locator('summary').click();
    await expect(disclosure).not.toHaveAttribute('open');
    await page.evaluate(() => window.introduction(false));
    await expect(disclosure).not.toHaveAttribute('open');
    await page.evaluate(() => window.unmount());
    await page.evaluate(() => window.introduction(false));
    await expect(disclosure).not.toHaveAttribute('open');
    await page.reload();
    await page.evaluate(() => window.introduction(false));
    await expect(disclosure).not.toHaveAttribute('open');
    await page.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(disclosure).toHaveAttribute('open', '');
    await page.reload();
    await page.evaluate(() => window.introduction(true));
    await expect(disclosure).toHaveAttribute('open', '');
  });
  await scenario(async page => {
    await page.evaluate(() => { window.smartcloudWpSuiteBackendChecks = { answers: async () => { window.calls++; return 'ready'; } }; window.mount(); });
    await expect(page.getByText('Backend administration access verified')).toBeVisible();
    const other = await page.context().newPage();
    try {
      await other.goto(`${base}/nested/wp-admin/admin.php?page=gatey`);
      await other.evaluate(() => { window.wpSuite = { siteSettings: {} }; window.mount(); });
      await expect(other.getByText('Connect this site', { exact: true })).toBeVisible();
      await other.evaluate(() => window.dispatchEvent(new Event('wpsuite-backend-session-changed')));
      await expect.poll(() => page.evaluate(() => window.calls)).toBe(2);
    } finally { await other.close(); }
  });
  await scenario(async page => {
    await page.evaluate(() => {
      window.detailCalls = 0; window.inventoryCalls = 0;
      window.smartcloudWpSuiteBackendChecks = { 'forms-workflows': async () => 'ready' };
      window.smartcloudWpSuiteBackendDetails = { 'forms-workflows': async (_signal, inventory) => {
        window.detailCalls++;
        if (inventory) window.inventoryCalls++;
        return { transport: 'gatey', endpoint: 'https://user:PRIVATE_PASSWORD@secondary.backend.test/stage?key=PRIVATE_KEY#PRIVATE_TOKEN', apiName: 'flow-api',
          ...(inventory ? { inventory: { workflows: { count: 3 }, templates: { count: 0 }, webhooks: { unavailable: 'failed' } } } : {}) };
      } };
      window.mount('forms-workflows', true, true);
    });
    const toggle = page.getByRole('button', { name: 'Backend access', exact: true });
    await expect(page.getByText('Gatey', { exact: true })).toBeVisible();
    await expect(page.getByText('Verified', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.inventoryCalls), 0, 'Collapsed panel performs no inventory requests');
    const panel = page.locator('.mantine-Accordion-root');
    assert.equal(Math.round(await panel.evaluate(node => node.getBoundingClientRect().width)), 640);
    await page.setViewportSize({width:390,height:800});
    assert.ok(await panel.evaluate(node => node.getBoundingClientRect().width) <= 390, 'Panel fits mobile');
    await toggle.click();
    await expect(page.getByText('https://secondary.backend.test/stage', {exact:true})).toBeVisible();
    await expect(page.getByText('3', {exact:true})).toBeVisible();
    await expect(page.getByText('0', {exact:true})).toBeVisible();
    await expect(page.getByText('Not available', {exact:true})).toBeVisible();
    assert.equal(await page.evaluate(() => window.inventoryCalls), 1);
    assert.doesNotMatch(await page.locator('body').innerText(), /PRIVATE_PASSWORD|PRIVATE_KEY|PRIVATE_TOKEN|Process maps/);
    await toggle.click(); await toggle.click();
    assert.equal(await page.evaluate(() => window.inventoryCalls), 1, 'Reopening reuses inventory cache');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.evaluate(() => window.inventoryCalls), 1, 'Focus does not refresh inventory');
    await page.getByRole('button', {name:'Check again',exact:true}).click();
    await expect.poll(() => page.evaluate(() => window.inventoryCalls)).toBe(2);
    await page.evaluate(() => window.unmount());
    await page.evaluate(() => window.mount('forms-workflows',true,true));
    await page.getByRole('button',{name:'Backend access',exact:true}).click();
    await expect(page.getByText('3',{exact:true})).toBeVisible();
    assert.equal(await page.evaluate(() => window.inventoryCalls), 2, 'Remount reuses cached inventory');
  });
  await scenario(async page => {
    await page.evaluate(() => {
      window.smartcloudWpSuiteBackendChecks = { answers: async () => 'ready' };
      window.smartcloudWpSuiteBackendDetails = { answers: async () => ({mode:'local-only',transport:'fetch',endpoint:'https://backend.test/api'}) };
      window.mount('answers',true,true);
    });
    await expect(page.getByText('Local only',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Backend access',exact:true}).click();
    await expect(page.getByText('Custom URL',{exact:false})).toBeVisible();
    await expect(page.getByText('This mode controls AI features. Chatbot and DocSearch replies require a backend.',{exact:true})).toBeVisible();
  });
  console.log(`Backend readiness: ${checks} browser scenarios passed.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
