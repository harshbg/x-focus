// Simulates the Android app: strict style CSP, native bridge, script injected repeatedly and late.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const script = fs.readFileSync(require('path').join(__dirname, '..', 'x-focus.user.js'), 'utf8');
const mock = fs.readFileSync(require('path').join(__dirname, 'mock.html'), 'utf8');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.route('https://x.com/**', r => r.fulfill({ contentType: 'text/html', headers: { 'content-security-policy': "style-src 'self'" }, body: mock }));
  await page.route('https://example.org/**', r => r.fulfill({ contentType: 'text/html', body: '<p>other</p>' }));
  await page.addInitScript(() => {
    const store = {}; window.__closed = 0; window.__grey = [];
    window.XFocusNative = { getValue: k => store[k] || '', setValue: (k, v) => { store[k] = v; }, close: () => { window.__closed++; }, setGrey: on => { window.__grey.push(on); }, checkUpdate: () => { window.__checks = (window.__checks || 0) + 1; }, tap: (x, y) => { const el = document.elementFromPoint(x / devicePixelRatio, y / devicePixelRatio); window.__taps = (window.__taps || []).concat([el && el.textContent]); if (el) el.click(); return true; }, _store: store };
  });
  await page.clock.install({ time: new Date() });
  await page.goto('https://x.com/home');
  await page.clock.runFor(500);
  // inject three times, like onPageStarted / commit / finished
  for (let i = 0; i < 3; i++) await page.evaluate(script);
  await page.clock.runFor(1500);
  ok(await page.evaluate(() => document.querySelectorAll('div[data-xfocus]').length) === 1, 'repeat injection runs once');
  ok(JSON.stringify(await page.evaluate(() => window.__grey)) === '[false]', 'app told to drop its own greyscale once the grey layer is up');
  const css = await page.evaluate(() => { const r = document.querySelector('div[data-xfocus]').shadowRoot; return { filter: getComputedStyle(r.querySelector('.grey')).backdropFilter, barBg: getComputedStyle(r.querySelector('.bar')).backgroundColor, adoptedDoc: document.adoptedStyleSheets.length, adoptedUi: r.adoptedStyleSheets.length, ovPos: getComputedStyle(r.querySelector('.ov')).position }; });
  ok(css.filter.includes('grayscale') && css.barBg === 'rgb(0, 0, 0)' && css.adoptedDoc === 1 && css.adoptedUi === 1 && css.ovPos === 'fixed', 'styles survive a strict style policy ' + JSON.stringify(css));
  await page.evaluate(() => [...document.querySelector('div[data-xfocus]').shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Start').click());
  await page.clock.runFor(7000);
  const nat = await page.evaluate(() => ({ native: JSON.parse(window.XFocusNative._store['xfocus.v1'] || 'null'), ls: localStorage.getItem('xfocus.v1') }));
  ok(nat.native && nat.native.limitMin === 30 && nat.native.usedSec >= 5, 'state saved through the native bridge ' + JSON.stringify(nat.native));
  ok(await page.evaluate(() => document.querySelectorAll('[data-xf-video]').length) === 10, 'video stubs in app mode');
  // "I'm done" calls native close
  await page.evaluate(() => { const s = JSON.parse(window.XFocusNative._store['xfocus.v1']); });
  await page.clock.runFor(300000);
  const t = await page.evaluate(() => document.querySelector('div[data-xfocus]').shadowRoot.querySelector('.ov').innerText);
  ok(/MINUTES GONE/i.test(t), 'check-in appears in app mode');
  await page.evaluate(() => [...document.querySelector('div[data-xfocus]').shadowRoot.querySelectorAll('button')].find(b => b.textContent.includes('done')).click());
  await page.clock.runFor(2000);
  ok(await page.evaluate(() => window.__closed) === 1, '"I\'m done" asks the app to close');
  // the app's real tap lands on the hidden tab and switches it
  await page.clock.runFor(63000);
  await page.evaluate(() => { const b = [...document.querySelector('div[data-xfocus]').shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Keep going'); if (b) b.click(); });
  await page.clock.runFor(1500);
  await page.evaluate(() => document.querySelector('div[data-xfocus]').shadowRoot.querySelectorAll('.nav button')[2].click());
  await page.clock.runFor(1500);
  const nt = await page.evaluate(() => ({ tab: window.__tab, taps: window.__taps, strip: getComputedStyle(document.getElementById('tabsnav')).pointerEvents }));
  if (!nt.taps) {
    await page.evaluate(() => document.querySelector('div[data-xfocus]').shadowRoot.querySelector('.main').click());
    await page.evaluate(() => [...document.querySelector('div[data-xfocus]').shadowRoot.querySelectorAll('button')].find(b => b.textContent.startsWith('Copy page details')).click());
    console.log((await page.evaluate(() => document.querySelector('div[data-xfocus]').shadowRoot.querySelector('.dump').value)).split('\n').slice(0, 14).join('\n'));
  }
  ok(nt.tab === 'Builders' && nt.taps && nt.taps[0] === 'Builders' && nt.strip === 'none', 'real tap from the app switches to the list, strip untappable again after ' + JSON.stringify(nt));
  // manual update check from settings
  await page.clock.runFor(63000);
  await page.evaluate(() => { const b = [...document.querySelector('div[data-xfocus]').shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Keep going'); if (b) b.click(); });
  await page.clock.runFor(1500);
  await page.evaluate(() => document.querySelector('div[data-xfocus]').shadowRoot.querySelector('.main').click());
  await page.evaluate(() => [...document.querySelector('div[data-xfocus]').shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Check for updates').click());
  await page.clock.runFor(9000);
  ok(await page.evaluate(() => window.__checks === 1 && /No newer version \(v\d/.test(document.querySelector('div[data-xfocus]').shadowRoot.querySelector('.ov').innerText)), '"Check for updates" asks the app and reports back');
  // not x.com: script is a no-op
  await page.goto('https://example.org/');
  await page.evaluate(script);
  await page.clock.runFor(1500);
  ok(await page.evaluate(() => document.querySelectorAll('[data-xfocus]').length) === 0, 'script does nothing off x.com');
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
