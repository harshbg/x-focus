const { chromium, devices } = require('playwright');
const fs = require('fs');
const script = fs.readFileSync(require('path').join(__dirname, '..', 'x-focus.user.js'), 'utf8');
const mock = fs.readFileSync(require('path').join(__dirname, 'mock.html'), 'utf8');
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const R = "document.querySelector('div[data-xfocus]').shadowRoot";
const sh = (page, sel) => page.evaluate(`(() => { const e = ${R}.querySelector(${JSON.stringify(sel)}); return e ? { text: e.textContent, hidden: e.hidden, disabled: e.disabled } : null; })()`);
const ovText = page => page.evaluate(`(() => { const o = ${R}.querySelector('.ov'); return o.hidden ? null : o.innerText; })()`);
const clickBtn = (page, label) => page.evaluate(`(() => { const b = [...${R}.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return 'nobtn'; if (b.disabled) return 'disabled'; b.click(); return 'ok'; })()`);
const slide = (page, v) => page.evaluate(`(() => { const i = ${R}.querySelector('#xf-limit'); i.value = '${v}'; i.dispatchEvent(new Event('input', { bubbles: true })); return { min: i.min, max: i.max, step: i.step, shown: ${R}.querySelector('.val').textContent }; })()`);
const st = page => page.evaluate(() => JSON.parse(localStorage.getItem('xfocus.v1')));
const today = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const flat = s => (s || '').replace(/\n/g, ' ');

(async () => {
  const browser = await chromium.launch();
  async function open(seed, path = '/home', opts = {}) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    page.on('pageerror', e => { fails++; console.log('PAGEERROR', e.message); });
    await page.route('https://x.com/**', r => r.fulfill({ contentType: 'text/html', body: mock }));
    await page.clock.install({ time: new Date() });
    if (seed) await page.addInitScript(s => { if (!localStorage.getItem('xfocus.v1')) localStorage.setItem('xfocus.v1', JSON.stringify(s)); }, seed);
    await page.addInitScript(script);
    await page.goto('https://x.com' + path);
    await page.clock.runFor(1500);
    // let the 3-second opening screen pass, unless the test is about it
    if (seed && seed.limitMin && !opts.keepGate && !path.startsWith('/i/flow')) await page.clock.runFor(3500);
    return { ctx, page };
  }
  const longPress = async (page, sel) => { const b = await page.locator(sel).boundingBox(); await page.mouse.move(b.x + 40, b.y + 40); await page.mouse.down(); await page.clock.runFor(700); await page.mouse.up(); await page.clock.runFor(300); };

  // 1. first run, slider setup
  let { ctx, page } = await open(null);
  ok(/MINUTES OF X PER DAY/i.test(await ovText(page) || ''), 'setup overlay on first run');
  const sl = await slide(page, 30);
  ok(sl.min === '5' && sl.max === '90' && sl.step === '5' && sl.shown === '30 min', 'limit slider 5 to 90 in steps of 5 ' + JSON.stringify(sl));
  await clickBtn(page, 'Start');
  await page.clock.runFor(3000);
  ok((await ovText(page)) === null, 'setup dismissed');
  const time1 = (await sh(page, '.time')).text;
  ok(/^29:5\d$/.test(time1), 'timer counting down: ' + time1);
  const grey = await page.evaluate(`({ layer: getComputedStyle(${R}.querySelector('.grey')).backdropFilter, root: document.documentElement.hasAttribute('data-xf-rootgrey'), zone: ${R}.querySelector('.bar').style.getPropertyValue('--zone'), segs: [...${R}.querySelectorAll('.seg b')].map(b => b.style.background) })`);
  ok(grey.layer.includes('grayscale') && grey.root === false, 'grey layer active, root filter off');
  ok(grey.zone === '#4aa3ff' && grey.segs.length === 3 && grey.segs[0] === 'rgb(74, 163, 255)' && grey.segs[1] === 'rgb(255, 214, 10)' && grey.segs[2] === 'rgb(255, 69, 58)', '30 min = three 10-minute blocks: blue, yellow, red ' + JSON.stringify(grey.segs));
  const lay = await page.evaluate(() => { const h = document.querySelector('div[data-xfocus]').getBoundingClientRect().height; return { h, pad: getComputedStyle(document.body).paddingTop, hdrTop: document.getElementById('hdr').getBoundingClientRect().top }; });
  ok(lay.h > 50 && parseFloat(lay.pad) === lay.h && lay.hdrTop === lay.h, 'bar pushes page down ' + JSON.stringify(lay));
  await page.evaluate(() => window.scrollTo(0, 900)); await page.clock.runFor(2000);
  ok(await page.evaluate(() => document.getElementById('hdr').getBoundingClientRect().top) === lay.h, 'sticky header sits under bar after scroll');
  const vid = await page.evaluate(() => { const m = [...document.querySelectorAll('[data-xf-video]')]; const c0 = document.getElementById('c0'); return { n: m.length, cls: m[0] && m[0].className, h: m[0] && m[0].getBoundingClientRect().height, textVisible: c0.querySelector('[data-testid=tweetText]').getBoundingClientRect().height > 0, photoVisible: document.querySelector('#c1 .ph').getBoundingClientRect().height }; });
  ok(vid.n === 10 && vid.cls === 'mwrap' && vid.h < 50 && vid.textVisible && vid.photoVisible === 180, 'videos collapsed to stub, text+photos kept');
  const ads = await page.evaluate(() => { const a = id => { const art = document.querySelector('#' + id + ' article'); return { marked: art.hasAttribute('data-xf-ad'), h: art.getBoundingClientRect().height, label: getComputedStyle(art, '::before').content, shown: [...art.children].filter(c => c.getBoundingClientRect().height > 0).length }; }; return { ad1: a('ad1'), ad2: a('ad2'), c8: a('c8') }; });
  ok(ads.ad1.marked && ads.ad2.marked && ads.ad1.h < 50 && ads.ad2.h < 50 && ads.ad1.shown === 0 && ads.ad2.shown === 0 && /Ad hidden/.test(ads.ad1.label) && !ads.c8.marked && ads.c8.shown > 0, 'ads become an empty dotted "Ad hidden" box; a post that only mentions Ad is kept ' + JSON.stringify(ads));
  const navInfo = await page.evaluate(`({ xbar: getComputedStyle(document.querySelector('[data-testid=BottomBar]')).display, nav: !${R}.querySelector('.nav').hidden, labels: [...${R}.querySelectorAll('.nav button span')].map(x => x.textContent), on: [...${R}.querySelectorAll('.nav button')].findIndex(b => b.classList.contains('on')), navTop: ${R}.querySelector('.nav').getBoundingClientRect().top, ih: innerHeight, pb: getComputedStyle(document.body).paddingBottom })`);
  ok(navInfo.xbar === 'none' && navInfo.nav && JSON.stringify(navInfo.labels) === '["Home","Following","Builders"]' && navInfo.on === 0 && navInfo.ih - navInfo.navTop >= 50 && parseFloat(navInfo.pb) >= 50, "X's bottom bar replaced by Home, Following and the first list " + JSON.stringify(navInfo));
  const strip = await page.evaluate(() => { const n = document.getElementById('tabsnav'), cs = getComputedStyle(n); const first = [...document.querySelectorAll('[data-testid=cellInnerDiv]')].find(c => c.getBoundingClientRect().height > 0); return { marked: document.querySelector('[data-xf-tabs]') && document.querySelector('[data-xf-tabs]').id, opacity: cs.opacity, pos: cs.position, logo: document.getElementById('logo').getBoundingClientRect().height, gap: Math.round(first.getBoundingClientRect().top - document.getElementById('logo').getBoundingClientRect().bottom), hdrH: document.getElementById('hdr').getBoundingClientRect().height }; });
  ok(strip.marked === 'tabsnav' && strip.opacity === '0' && strip.pos === 'absolute' && strip.logo > 0, 'scrolling tab strip at the top hidden, rest of the header kept ' + JSON.stringify(strip));
  ok(strip.gap <= 2 && strip.hdrH < 60, 'no empty space left where the tabs were ' + JSON.stringify(strip));
  const fab = await page.evaluate(`({ fab: document.getElementById('fab').getBoundingClientRect().bottom, navTop: ${R}.querySelector('.nav').getBoundingClientRect().top })`);
  ok(fab.fab <= fab.navTop - 8, 'compose button sits above the three buttons ' + JSON.stringify(fab));
  await page.evaluate(`[...${R}.querySelectorAll('.nav button')][2].click()`); await page.clock.runFor(800);
  ok(await page.evaluate(() => window.__tab) === 'Builders' && await page.evaluate(`[...${R}.querySelectorAll('.nav button')][2].classList.contains('on')`), 'list button opens the first list');
  await page.evaluate(`[...${R}.querySelectorAll('.nav button')][1].click()`); await page.clock.runFor(800);
  ok(await page.evaluate(() => window.__tab) === 'Following', 'Following button opens Following');
  await page.evaluate(`[...${R}.querySelectorAll('.nav button')][0].click()`); await page.clock.runFor(800);
  ok(await page.evaluate(() => window.__tab) === 'For you', 'Home button opens For you');
  const sp = await page.evaluate(() => ({ card: getComputedStyle(document.querySelector('#c5 [data-testid="card.wrapper"]'), '::before').content, cardKids: [...document.querySelector('#c5 [data-testid="card.wrapper"]').children].filter(c => c.getBoundingClientRect().height > 0).length, text: document.querySelector('#c5 [data-testid=tweetText]').getBoundingClientRect().height > 0, bar: document.getElementById('spacebar').getBoundingClientRect().height, live: document.getElementById('livebar').getBoundingClientRect().height }));
  ok(/Space hidden/.test(sp.card) && sp.cardKids === 0 && sp.text && sp.bar === 0 && sp.live === 0, 'Spaces: card becomes a stub, live bar without Space links removed too ' + JSON.stringify(sp));
  const aud = await page.evaluate(async () => { const a = document.createElement('audio'); try { await a.play(); return 'played'; } catch (e) { return e.name; } });
  ok(aud === 'NotAllowedError', 'audio (Spaces) cannot play');
  const play = await page.evaluate(async () => { const v = document.querySelector('video'); try { await v.play(); return 'played'; } catch (e) { return e.name; } });
  ok(play === 'NotAllowedError', 'video.play() blocked');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.clock.runFor(500);
  await page.evaluate(() => document.getElementById('modal').classList.add('on')); await page.clock.runFor(2000);
  const mod = await page.evaluate(() => { const r = document.getElementById('modal').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, ih: innerHeight }; });
  ok(mod.top === lay.h && mod.bottom === mod.ih, 'full-screen sheet moved below bar');
  await page.evaluate(() => document.getElementById('modal').classList.remove('on'));

  // colour peek
  await longPress(page, '#c1 .ph');
  let pk = await page.evaluate(`({ clip: ${R}.querySelector('.grey').style.clipPath, chip: ${R}.querySelector('.chip.on').textContent, hidden: ${R}.querySelector('.chip.on').hidden, path: location.pathname })`);
  ok(pk.clip.startsWith('polygon(evenodd') && !pk.hidden && /Colour 0[45]:\d\d/.test(pk.chip) && pk.path === '/home', 'long-press on a picture opens a colour window and does not open the post ' + pk.chip);
  await page.clock.runFor(10000);
  let s = await st(page);
  ok(s.colorUsedSec >= 8 && s.colorUsedSec <= 12, 'colour clock ticks only while colour is on: ' + s.colorUsedSec);
  await page.evaluate(`${R}.querySelector('.chip.on').click()`); await page.clock.runFor(5000);
  ok((await sh(page, '.chip.on')).hidden && (await st(page)).colorUsedSec <= 12 && await page.evaluate(`${R}.querySelector('.grey').style.clipPath`) === '', 'tapping the colour chip ends it and stops its clock');
  await longPress(page, '#c2 [data-testid=tweetText]');
  ok((await sh(page, '.chip.on')).hidden, 'long-press on plain text does nothing');

  // settings
  await page.evaluate(`${R}.querySelector('.main').click()`);
  ok(/DAILY LIMIT/i.test(await ovText(page) || ''), 'settings opens on bar tap');
  ok(/Search\s+Notifications \(3\)\s+Chat/.test(await ovText(page) || ''), 'settings starts with Search, Notifications (with unread count) and Chat');
  await page.evaluate(`[...${R}.querySelectorAll('button')].find(b => b.textContent.startsWith('Copy page details')).click()`);
  await page.clock.runFor(500);
  const dump = await page.evaluate(`${R}.querySelector('.dump') && ${R}.querySelector('.dump').value`);
  ok(dump && dump.includes('X Focus 2.') && dump.includes('== tab strip and its parents') && dump.includes('role=tablist') && dump.split('\n').length > 20, 'page details report built (' + (dump || '').split('\n').length + ' lines)');
  await slide(page, 40);
  await clickBtn(page, '10 min');
  await page.evaluate(`${R}.querySelector('#xf-hideposts').click()`);
  await clickBtn(page, 'Done'); await page.clock.runFor(1200);
  s = await st(page);
  ok(s.limitMin === 30 && s.pendingLimitMin === 40 && s.pendingFrom > today() && s.hidePosts === true && s.colorMin === 10 && s.hideAds === true && s.clean === true, 'raise deferred to tomorrow; colour 10 min and toggles saved');
  ok(await page.evaluate(() => document.getElementById('c0').getBoundingClientRect().height === 0 && document.getElementById('c1').getBoundingClientRect().height > 0), 'video posts hidden entirely when option on');
  ok(await page.evaluate(() => /night_mode=2/.test(document.cookie)), 'black theme cookie set');
  await ctx.close();

  // settings shortcuts open X's pages; a button pressed away from Home loads Home, then the tab
  ({ ctx, page } = await open({ limitMin: 30, day: today(), usedSec: 100, weekSeen: today(), ts: Date.now() }));
  await page.evaluate(`${R}.querySelector('.main').click()`);
  await Promise.all([page.waitForURL('**/i/chat'), clickBtn(page, 'Chat')]);
  await page.clock.runFor(5000);
  ok(await page.evaluate(() => location.pathname) === '/i/chat' && (await ovText(page)) === null, 'Chat in settings opens chat');
  ok(await page.evaluate(`[...${R}.querySelectorAll('.nav button')].every(b => !b.classList.contains('on'))`), 'no button lit away from Home');
  await Promise.all([page.waitForURL('**/home'), page.evaluate(`[...${R}.querySelectorAll('.nav button')][1].click()`)]);
  await page.clock.runFor(2500);
  ok(await page.evaluate(() => location.pathname + ' ' + document.querySelector('[role=tab][aria-selected=true]').textContent) === '/home Following', 'Following from another page loads Home and selects Following');
  await page.clock.runFor(2000); // the mock reloads the page, so the opening screen shows first
  await page.evaluate(`${R}.querySelector('.main').click()`);
  await page.evaluate(`${R}.querySelector('#xf-nav').click()`);
  await clickBtn(page, 'Done'); await page.clock.runFor(1200);
  ok(await page.evaluate(`(() => getComputedStyle(document.querySelector('[data-testid=BottomBar]')).display !== 'none' && ${R}.querySelector('.nav').hidden && document.getElementById('tabsnav').getBoundingClientRect().height > 0)()`), "switching the three buttons off brings back X's bar and tabs");
  await ctx.close();
  ({ ctx, page } = await open({ limitMin: 30, day: today(), usedSec: 100, weekSeen: today(), ts: Date.now() }, '/i/spaces/1abc'));
  await page.clock.runFor(3000);
  ok(await page.evaluate(() => location.pathname) === '/home', 'opening a Space link goes back to Home');
  await ctx.close();

  // 2. check-in: one minute, clock paused
  ({ ctx, page } = await open({ limitMin: 30, day: today(), usedSec: 596, ackCp: 1, ts: Date.now() }));
  await page.clock.runFor(5000);
  let t = await ovText(page);
  ok(/10\s*MINUTES GONE/i.test(flat(t)), 'check-in at 10 min');
  await page.clock.runFor(40000);
  ok((await clickBtn(page, 'Keep going')) === 'disabled', 'still locked 45 s into the check-in');
  await page.clock.runFor(21000);
  ok((await clickBtn(page, 'Keep going')) === 'ok', 'keep going enabled after one minute');
  await page.clock.runFor(1500);
  s = await st(page);
  ok((await ovText(page)) === null && s.ackCp === 2 && s.usedSec < 603, 'check-in dismissed; the minute of waiting did not use the budget: ' + s.usedSec);
  await page.clock.runFor(60000);
  ok((await ovText(page)) === null, 'no repeat until next 5 min');
  await ctx.close();
  ({ ctx, page } = await open({ limitMin: 30, day: today(), usedSec: 905, ackCp: 2, ts: Date.now() }));
  ok(/15\s*MINUTES GONE/i.test(flat(await ovText(page))), 'unacknowledged check-in returns after reload');
  ok(await page.evaluate(`${R}.querySelector('.bar').style.getPropertyValue('--zone')`) === '#ffd60a', 'middle third is yellow');
  await ctx.close();

  // 3. lock + extension
  ({ ctx, page } = await open({ limitMin: 30, day: today(), usedSec: 1796, ackCp: 5, ts: Date.now() }));
  ok(await page.evaluate(`${R}.querySelector('.bar').style.getPropertyValue('--zone')`) === '#ff453a', 'last third is red');
  await page.clock.runFor(6000);
  ok(/TIME.S UP/i.test(await ovText(page) || ''), 'locks at limit');
  ok((await sh(page, '.time')).text === '00:00', 'timer shows 00:00');
  await page.clock.runFor(20000);
  await clickBtn(page, 'I need 5 more');
  ok((await clickBtn(page, 'Wait')) === 'disabled', 'extension wait running');
  await page.clock.runFor(31000);
  ok((await clickBtn(page, 'Take 5 more')) === 'ok', 'extension granted after wait');
  await page.clock.runFor(2500);
  s = await st(page);
  ok((await ovText(page)) === null && s.extCount === 1 && s.extraSec === 300 && /^04:5\d$/.test((await sh(page, '.time')).text), 'unlocked with 5 more min; no time counted while locked');
  await ctx.close();

  // 90 minutes = nine blocks, 3 blue, 3 yellow, 3 red; 20 minutes splits a block exactly at each third
  ({ ctx, page } = await open({ limitMin: 90, day: today(), usedSec: 900, ts: Date.now() }));
  const b90 = await page.evaluate(`[...${R}.querySelectorAll('.seg b')].map(b => [b.style.background, b.style.clipPath])`);
  const cols = b90.map(x => x[0]);
  ok(cols.length === 9 && cols.slice(0, 3).every(c => c === 'rgb(74, 163, 255)') && cols.slice(3, 6).every(c => c === 'rgb(255, 214, 10)') && cols.slice(6).every(c => c === 'rgb(255, 69, 58)'), '90 min = 9 blocks: 3 blue, 3 yellow, 3 red');
  ok(/inset\(0(px)? 0(px)? 0(px)? 100%\)/.test(b90[0][1]) && /5\d(\.\d)?%\)/.test(b90[1][1]) && /0(px)? 0(px)? 0(px)? 0(%|px)\)/.test(b90[2][1]), 'after 15 min: first block spent, second about half, rest full ' + JSON.stringify(b90.slice(0, 3).map(x => x[1])));
  await ctx.close();
  ({ ctx, page } = await open({ limitMin: 20, day: today(), usedSec: 10, ts: Date.now() }));
  const b20 = await page.evaluate(`[...${R}.querySelectorAll('.seg b')].map(b => b.style.background)`);
  ok(b20.length === 2 && /linear-gradient/.test(b20[0]) && /66\.7%/.test(b20[0]) && /33\.3%/.test(b20[1]), '20 min = 2 blocks, split at exact thirds ' + JSON.stringify(b20));
  await ctx.close();

  // 4. new day resets, pending limit applies; old 180-minute limits are capped
  ({ ctx, page } = await open({ limitMin: 30, pendingLimitMin: 40, pendingFrom: today(), day: '2020-01-01', usedSec: 1800, colorUsedSec: 250, ackCp: 6, extCount: 2, extraSec: 600, ts: 5 }));
  s = await st(page);
  ok(s.limitMin === 40 && s.usedSec < 5 && s.colorUsedSec === 0 && s.extCount === 0 && s.day === today(), 'new day: reset + pending limit applied');
  const before = (await sh(page, '.time')).text;
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); });
  await page.clock.runFor(30000);
  ok((await sh(page, '.time')).text === before, 'no counting while tab hidden');
  await ctx.close();

  // 5. colour allowance runs out
  ({ ctx, page } = await open({ limitMin: 30, day: today(), usedSec: 100, colorUsedSec: 295, ts: Date.now() }));
  await longPress(page, '#c1 .ph');
  ok(!(await sh(page, '.chip.on')).hidden, 'colour starts with 5 s left');
  await page.clock.runFor(7000);
  ok((await sh(page, '.chip.on')).hidden && /used up/.test((await sh(page, '.sub')).text), 'colour ends when the allowance is spent: ' + (await sh(page, '.sub')).text);
  await page.clock.runFor(5000);
  await longPress(page, '#c1 .ph');
  ok((await sh(page, '.chip.on')).hidden && /No colour time left/.test((await sh(page, '.sub')).text), 'no more colour today');
  await ctx.close();

  // opening delay: 3 s of black, clock paused, again after being away
  const dkey = n => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - n); const p = v => String(v).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
  ({ ctx, page } = await open({ limitMin: 30, day: today(), usedSec: 100, weekSeen: today(), ts: Date.now() }, '/home', { keepGate: true }));
  ok(/OPENING X/i.test(await ovText(page) || '') && /^[123]/.test(await ovText(page)), 'opening screen with countdown: ' + flat(await ovText(page)).slice(0, 40));
  await page.clock.runFor(3000);
  s = await st(page);
  ok((await ovText(page)) === null, 'opening screen clears itself after 3 s');
  await page.clock.runFor(6000);
  s = await st(page);
  ok(s.usedSec >= 104 && s.usedSec <= 108, 'opening screen did not use the budget: ' + s.usedSec);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => window.__vis || 'visible', configurable: true }); window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(5000);
  await page.evaluate(() => { window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(1200);
  ok((await ovText(page)) === null, 'a 5-second glance away does not bring the opening screen back');
  await page.evaluate(() => { window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(20000);
  await page.evaluate(() => { window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(1200);
  ok(/OPENING X/i.test(await ovText(page) || ''), 'coming back after 20 s shows it again');
  await ctx.close();

  // weekly summary: yesterday is recorded at midnight; summary appears once every 7 days
  const hist = {}; for (let i = 2; i <= 8; i++) hist[dkey(i)] = { u: 600 * (i % 3 + 1), x: i === 3 ? 2 : 0, c: 0 };
  ({ ctx, page } = await open({ limitMin: 30, day: dkey(1), usedSec: 1500, extCount: 1, extraSec: 300, weekSeen: dkey(8), hist, ts: 5 }));
  await page.clock.runFor(1500);
  s = await st(page);
  ok(s.hist[dkey(1)] && s.hist[dkey(1)].u === 1500 && s.hist[dkey(1)].x === 1 && s.usedSec < 5, 'yesterday saved into history at the day change');
  t = flat(await ovText(page));
  const expectMin = Math.round((1500 + [2, 3, 4, 5, 6, 7].reduce((a, i) => a + 600 * (i % 3 + 1), 0)) / 60);
  ok(/YOUR WEEK ON X/i.test(t) && t.includes(expectMin + ' min in 7 days') && t.includes('extra time taken 3×'), 'weekly summary shows totals: ' + t.slice(0, 120));
  await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'xf-week.png') });
  await clickBtn(page, 'OK'); await page.clock.runFor(1500);
  ok((await ovText(page)) === null && (await st(page)).weekSeen === today(), 'summary dismissed for another week');
  await ctx.close();

  // 6. login page untouched, but still grey
  ({ ctx, page } = await open({ limitMin: 30, day: today(), usedSec: 100, ts: Date.now() }, '/i/flow/login'));
  await page.clock.runFor(5000);
  const lg = await page.evaluate(() => ({ disp: getComputedStyle(document.querySelector('div[data-xfocus]')).display, pad: getComputedStyle(document.body).paddingTop, filter: getComputedStyle(document.documentElement).filter }));
  ok(lg.disp === 'none' && lg.pad === '0px' && lg.filter.includes('grayscale') && (await st(page)).usedSec === 100, 'login flow: no bar, no counting, still grey');
  await ctx.close();
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
})().catch(e => { console.error('ERR', e); process.exit(1); });
