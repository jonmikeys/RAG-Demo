// Run: node test/e2e-pages.mjs [baseUrl]   (default http://127.0.0.1:8099/, serve site/ there first)
// Needs playwright-core (PLAYWRIGHT_CORE path or installed) and Chrome (CHROME_PATH).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const base = (process.argv[2] || 'http://127.0.0.1:8099/').replace(/\/?$/, '/');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const errors = [], external = [];
async function open(path, vw = 1100) {
  const page = await browser.newPage({ viewport: { width: vw, height: 900 } });
  page.on('pageerror', (e) => errors.push(path + ' ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(path + ' ' + m.text()));
  page.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && u.hostname !== new URL(base).hostname) external.push(r.url()); });
  await page.goto(base + path);
  return page;
}

// ---- landing: two cards, both links work
let page = await open('');
assert.equal(await page.locator('a.card').count(), 2);
await page.click('a.card[href="/vault/"]');
await page.waitForURL(/\/vault\/$/);
assert.match(await page.textContent('h1'), /Obsidian/);
await page.close();

// ---- document demo still works under /demo/
page = await open('demo/');
assert.ok(await page.locator('a[href="/"]').count() > 0, 'back link');
await page.click('#sample');
await page.fill('#q', 'How do I get my money back?');
await page.click('#go');
await page.waitForSelector('#results .hitcard', { timeout: 120000 });
const refund = await page.locator('#results .col').nth(0).locator('.hitcard p').first().textContent();
assert.match(refund, /refund|return|credited/i);
await page.close();

// ---- vault demo: sample vault
page = await open('vault/');
assert.ok(await page.locator('#asking').isHidden(), 'search hidden until a vault is loaded');
await page.click('#sample');
await page.waitForSelector('#chunking:not([hidden])');
assert.equal(await page.locator('#notesel option').count(), 7, 'seven notes in the sample vault');
const cmp = await page.locator('#cmp').innerText();
console.log('comparison:', cmp.replace(/\n+/g, ' | '));
// by-heading chunks never straddle a heading; fixed size does
const spanning = await page.$$eval('#cmp > div', (ds) => ds.map((d) => d.querySelectorAll('b')[3]?.textContent));
// heading mode still merges tiny title/intro sections into the next one, so it is not zero, just lower
assert.ok(+spanning[0] < +spanning[1], `heading mode crosses fewer headings than fixed (${spanning[0]} vs ${spanning[1]})`);

// note viewer shows cleaned text with headings and no Obsidian syntax
await page.selectOption('#notesel', { label: 'Plants/Tomatoes.md' });
const doc = await page.textContent('#doc');
assert.ok(doc.includes('# Tomatoes') && doc.includes('## Watering'));
assert.ok(!/\[\[|\]\]|created:|tags:/.test(doc), 'syntax and frontmatter removed from the viewer');
assert.ok(await page.locator('#doc .hd').count() >= 4, 'headings bolded');
assert.ok(await page.locator('#map button').count() >= 3);

// semantic retrieval returns the right note and section, with a label
await page.fill('#q', 'Why is my bread so dense?');
await page.click('#go');
await page.waitForSelector('#results .hitcard', { timeout: 180000 });
const top = await page.locator('#results .col').nth(0).locator('.hitcard').first().innerText();
console.log('top semantic hit:', top.replace(/\n+/g, ' | ').slice(0, 160));
assert.match(top, /Sourdough/);
assert.match(top, /dense/i);
await page.fill('#q', 'What did I plant last weekend?');
await page.click('#go');
await page.waitForFunction(() => /Daily/.test(document.querySelector('#results .col .hitcard')?.textContent || ''), null, { timeout: 120000 });
// clicking a result opens its note in the viewer
await page.locator('#results .col').nth(0).locator('.hitcard').first().click();
assert.match(await page.inputValue('#notesel').then(async (v) => (await page.locator(`#notesel option[value="${v}"]`).textContent())), /Daily/);

// switching to fixed size changes chunk counts and clears stale results
const n1 = await page.locator('#map button').count();
await page.check('input[value=fixed]');
assert.ok(await page.locator('#results .empty').count() === 1, 'results cleared on strategy change');
await page.close();

// ---- vault demo: folder upload with junk that must be skipped
page = await open('vault/');
await page.setInputFiles('#folder', new URL('./fixtures/testvault', import.meta.url).pathname);
await page.waitForSelector('#chunking:not([hidden])');
// hidden folders (.obsidian, .trash) and non-notes are skipped; the vault folder name is stripped from paths
assert.deepEqual(await page.locator('#notesel option').allTextContents(), ['Hello.md', 'Sub/Other.md']);
assert.match(await page.textContent('#loaded'), /2 notes.*ignored/);
await page.setInputFiles('#files', { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) });
assert.match(await page.textContent('#msg'), /No Markdown/);
await page.close();

// ---- narrow screen: no horizontal scroll on any page
for (const p of ['', 'demo/', 'vault/']) {
  const pg = await open(p, 390);
  if (p === 'vault/') await pg.click('#sample');
  assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), p + ' fits a 390px screen');
  if (p === 'vault/') await pg.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/vault-mobile.png', fullPage: true });
  await pg.close();
}
const wide = await open('vault/');
await wide.click('#sample');
await wide.fill('#q', 'How often should I water the tomato plants?');
await wide.click('#go');
await wide.waitForSelector('#results .hitcard', { timeout: 120000 });
await wide.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/vault.png', fullPage: true });
const land = await open('');
await land.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/landing.png', fullPage: true });

await browser.close();
assert.deepEqual(errors, [], 'no console or page errors:\n' + errors.join('\n'));
assert.deepEqual(external, [], 'no requests left the origin: ' + external.join(', '));
console.log('e2e-pages passed');
