/** PHP-rendered shared navigation; no React or external service dependency. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = execFileSync('php', [resolve(root, 'tests/admin-top-navigation.test.php'), '--render'], {encoding:'utf8'});
const css = await readFile(resolve(root, 'php/assets/css/admin-top-navigation.css'));
const js = await readFile(resolve(root, 'php/assets/js/admin-top-navigation.js'));
const server = createServer((req,res) => {
  if(req.url === '/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  if(req.url === '/script.js'){res.setHeader('Content-Type','application/javascript');res.end(js);return;}
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><main style="margin:20px"><button id="before">Before navigation</button>${html}<button id="after">After navigation</button><h1>Plugin-owned screen</h1></main><script src="/script.js"></script>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const nav=page.getByRole('navigation',{name:'WP Suite navigation'});
  const toggle=nav.getByRole('button',{name:'Tools on this site'});
  const panel=page.locator('#wpsuite-advanced-navigation');
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  assert.ok(await toggle.evaluate(el=>{const a=el.getBoundingClientRect(), b=el.querySelector('svg').getBoundingClientRect();return Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<1;}), 'Chevron vertically centered');
  await toggle.hover();
  await panel.waitFor({state:'visible'});
  await page.mouse.move(1000,800);await panel.waitFor({state:'hidden'});
  await toggle.click();await panel.waitFor({state:'visible'});
  await toggle.click();await panel.waitFor({state:'hidden'});
  await toggle.press('Enter');await panel.waitFor({state:'visible'});
  await toggle.press('ArrowDown');
  assert.equal(await panel.getByRole('link').first().evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  assert.equal(await toggle.evaluate(el=>el===document.activeElement),true);
  await page.mouse.move(1000,800);
  await page.locator('#before').focus();await page.keyboard.press('Tab');
  assert.equal(await nav.getByRole('link',{name:'Overview',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Tab');await panel.waitFor({state:'visible'});
  assert.equal(await toggle.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Tab');assert.equal(await panel.getByRole('link').first().evaluate(el=>el===document.activeElement),true);
  await page.locator('#after').focus();await panel.waitFor({state:'hidden'});
  await toggle.click();
  assert.equal(await page.locator('.wpsuite-top-navigation__groups').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
  const link=panel.getByRole('link',{name:'API settings',exact:true});
  assert.equal(await link.getAttribute('href'),'https://example.test/subsite/wp-admin/admin.php?page=gatey&section=api-settings');
  await page.setViewportSize({width:390,height:700});
  assert.equal(await page.locator('.wpsuite-top-navigation__groups').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
  const box=await panel.boundingBox();assert(box.x>=0&&box.x+box.width<=390);
  assert.equal(await panel.evaluate(el=>getComputedStyle(el).overflowY),'auto');
  await page.locator('#before').click();await panel.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('Admin top navigation browser checks passed: hover, click, focus, keyboard, Escape, normal tab order, exact deep links, two-column desktop and mobile layout.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
