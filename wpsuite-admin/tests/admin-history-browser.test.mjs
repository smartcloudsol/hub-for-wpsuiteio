import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  stdin: { resolveDir: root, contents: `
    import { createAdminSectionHistory } from './src/admin-section-history';
    let current = 'general';
    window.calls = [];
    window.block = false;
    window.denied = false;
    history.replaceState({ otherApplication: 'keep' }, '', location.href);
    const controller = createAdminSectionHistory({
      current: () => current,
      resolve: search => new URLSearchParams(search).get('section') || new URLSearchParams(search).get('aikit-page') || 'general',
      apply: requested => {
        window.calls.push(requested);
        if (window.block) return false;
        current = window.denied && requested === 'protected' ? 'general' : requested;
        window.current = current;
        return current;
      },
    });
    window.current = current;
    window.select = controller.select;
    window.dispose = controller.dispose;
    window.boot = Math.random();
  ` },
  bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
});
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(`<script>${bundle.outputFiles[0].text}</script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/wp-admin/admin.php?page=smartcloud-ai-kit&keep=1&aikit-page=general#help`);
  const boot = await page.evaluate(() => window.boot);
  const initialLength = await page.evaluate(() => history.length);
  await page.evaluate(() => window.select('chatbot-settings'));
  let url = new URL(page.url());
  assert.equal(url.searchParams.get('page'), 'smartcloud-ai-kit');
  assert.equal(url.searchParams.get('keep'), '1');
  assert.equal(url.searchParams.get('section'), 'chatbot-settings');
  assert.equal(url.searchParams.has('aikit-page'), false);
  assert.equal(url.hash, '#help');
  assert.equal(await page.evaluate(() => history.state.otherApplication), 'keep');
  assert.equal(await page.evaluate(() => history.length), initialLength + 1);
  await page.evaluate(() => window.select('chatbot-settings'));
  assert.equal(await page.evaluate(() => history.length), initialLength + 1);
  await page.evaluate(() => window.select('conversation-profile'));
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => window.current === 'chatbot-settings');
  assert.equal(new URL(page.url()).searchParams.get('section'), 'chatbot-settings');
  await page.evaluate(() => history.forward());
  await page.waitForFunction(() => window.current === 'conversation-profile');
  assert.equal(await page.evaluate(() => history.length), initialLength + 2);
  const committed = page.url();
  await page.evaluate(() => { window.block = true; window.select('general'); });
  assert.equal(page.url(), committed);
  const beforeRejectedBack = await page.evaluate(() => window.calls.length);
  await page.evaluate(() => history.back());
  await page.waitForFunction(count => window.calls.length > count && location.search.includes('section=conversation-profile'), beforeRejectedBack);
  assert.equal(await page.evaluate(() => window.current), 'conversation-profile');
  await page.evaluate(() => { window.block = false; history.back(); });
  await page.waitForFunction(() => window.current === 'chatbot-settings');
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => window.current === 'general');
  assert.equal(new URL(page.url()).searchParams.get('keep'), '1');
  await page.evaluate(() => history.forward());
  await page.waitForFunction(() => window.current === 'chatbot-settings');
  assert.equal(await page.evaluate(() => window.boot), boot, 'Navigation must not reload the document');
  // A previously valid destination becomes denied after permission/config changes.
  await page.evaluate(() => window.select('protected'));
  await page.evaluate(() => window.select('general'));
  const beforeDeniedBack = await page.evaluate(() => window.calls.length);
  await page.evaluate(() => { window.denied = true; history.back(); });
  await page.waitForFunction(count => window.calls.length > count && location.search.includes('section=general'), beforeDeniedBack);
  assert.equal(await page.evaluate(() => window.current), 'general');
  const calls = await page.evaluate(() => window.calls.length);
  await page.evaluate(() => { window.dispose(); history.back(); });
  await page.waitForFunction(() => location.search.includes('section=chatbot-settings'));
  assert.equal(await page.evaluate(() => window.calls.length), calls, 'Disposed listeners must not navigate');

  // The product shell pushes panel entries into the same stack as native sections.
  // Cancelling a staged section change must restore the latest shell entry, not
  // the last entry created by the section controller itself.
  await page.goto(`http://127.0.0.1:${server.address().port}/wp-admin/admin.php?page=smartcloud-ai-kit&section=general`);
  await page.evaluate(() => window.select('chatbot-settings'));
  const beforePanel = await page.evaluate(() => window.calls.length);
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('panel', 'summary');
    const marker = history.state.wpsuiteAdminSectionHistory;
    history.pushState({ ...history.state, wpsuiteAdminSectionHistory: { ...marker, index: marker.index + 1 } }, '', url);
    window.dispatchEvent(new Event('wpsuite-admin-history-change'));
  });
  const panelUrl = page.url();
  const panelIndex = await page.evaluate(() => history.state.wpsuiteAdminSectionHistory.index);
  assert.equal(await page.evaluate(() => window.calls.length), beforePanel, 'Panel pushes must not apply a native section');
  await page.evaluate(() => { window.block = true; window.select('conversation-profile'); });
  assert.equal(page.url(), panelUrl, 'Rejected staged navigation must retain the shell panel');
  const beforePanelBack = await page.evaluate(() => window.calls.length);
  await page.evaluate(() => history.back());
  await page.waitForFunction(({ calls, url, index }) => window.calls.length > calls && location.href === url && history.state.wpsuiteAdminSectionHistory.index === index,
    { calls: beforePanelBack, url: panelUrl, index: panelIndex });
  assert.equal(await page.evaluate(() => window.current), 'chatbot-settings');
  await page.evaluate(() => { window.block = false; history.back(); });
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('panel'));
  assert.equal(await page.evaluate(() => history.state.wpsuiteAdminSectionHistory.index), panelIndex - 1,
    'Cancellation must restore the entry without overwriting its predecessor');
  await page.evaluate(() => history.forward());
  await page.waitForFunction(url => location.href === url, panelUrl);
  assert.equal(await page.evaluate(() => history.state.wpsuiteAdminSectionHistory.index), panelIndex);
  console.log('Admin history browser: URL/state preservation, canonical sections, no reload, Back/Forward, guard cancellation, external panel history and cleanup passed.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
