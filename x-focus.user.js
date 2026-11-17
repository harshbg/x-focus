// ==UserScript==
// @name         X Focus
// @namespace    x-focus
// @version      2.4.0
// @description  X without video or ads, in greyscale, with a daily time budget and a check-in every 5 minutes.
// @match        https://x.com/*
// @match        https://mobile.x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.twitter.com/*
// @downloadURL  https://raw.githubusercontent.com/harshbg/x-focus/main/x-focus.user.js
// @updateURL    https://raw.githubusercontent.com/harshbg/x-focus/main/x-focus.user.js
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

(function () {
  'use strict';

  try { if (window.top !== window.self) return; } catch (e) { return; }
  if (!/(^|\.)(x|twitter)\.com$/.test(window.location.hostname || '')) return;
  if (window.__xFocusOn) return;
  window.__xFocusOn = true;

  var VERSION = '2.4.0';

  // Present only inside the X Focus Android app.
  var NATIVE = null;
  try { if (window.XFocusNative && typeof window.XFocusNative.getValue === 'function') NATIVE = window.XFocusNative; } catch (e) {}

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  var STEP = 300;                 // seconds between check-ins (5 minutes)
  var BLOCK = 600;                // seconds per block in the progress bar (10 minutes)
  var GATE_WAIT = 3;              // seconds of black screen each time X is opened
  var REOPEN_AFTER = 15000;       // away this long (ms) counts as opening X again
  var HIST_DAYS = 14;             // days of history kept for the weekly summary
  var CHECK_WAIT = 60;            // seconds a check-in holds the screen before "Keep going" unlocks
  var KEY = 'xfocus.v1';
  var MIN_LIMIT = 5, MAX_LIMIT = 90, LIMIT_STEP = 5, DEFAULT_LIMIT = 30;
  var COLOR_CHOICES = [0, 5, 10]; // minutes of colour per day
  var ZONES = ['#4aa3ff', '#ffd60a', '#ff453a']; // first, middle and last third of the day's budget

  var PLAYER_SEL = '[data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="previewInterstitial"]';
  var VIDEO_SEL = 'video, ' + PLAYER_SEL;
  // Things that mean "this ancestor holds more than just the video".
  var CONTENT_SEL = 'img, a, button, video, time, [role="button"], [role="link"], [data-testid="tweetText"], [data-testid="User-Name"]';
  // Long-pressing one of these inside a post shows the post in colour.
  var PICTURE_SEL = 'img, svg, canvas, [data-testid="tweetPhoto"], [data-testid="card.wrapper"], [style*="background-image"]';
  // X's own pages that move from the bottom bar into the settings screen.
  var GO_TO = [
    { label: 'Search', testid: 'AppTabBar_Explore_Link', path: '/explore' },
    { label: 'Notifications', testid: 'AppTabBar_Notifications_Link', path: '/notifications' },
    { label: 'Chat', testid: 'AppTabBar_DirectMessage_Link', path: '/messages' }
  ];
  var PENDING_TAB = 'xfocus.tab';  // sessionStorage: Home tab to select once /home has loaded
  // Counted when deciding how much of the header belongs to the Home tab strip.
  var STRIP_SEL = 'a, img, h1, h2, input, [role="link"]';

  // Greyscale is a full-screen layer under the timer, so the timer keeps its
  // colours and a hole can be cut in the layer to show one post in colour.
  var BACKDROP_OK = (function () {
    try {
      return !!(window.CSS && CSS.supports &&
        (CSS.supports('backdrop-filter', 'grayscale(1)') || CSS.supports('-webkit-backdrop-filter', 'grayscale(1)')));
    } catch (e) { return false; }
  })();

  var STUB_BOX = 'display:block!important;height:auto!important;min-height:0!important;max-height:none!important;' +
    'aspect-ratio:auto!important;padding:0!important;overflow:hidden!important;' +
    'border:1px dashed rgb(113,118,123)!important;border-radius:12px!important';
  var STUB_LABEL = 'display:block;padding:10px 14px;color:rgb(113,118,123);' +
    'font:700 12px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.08em;text-transform:uppercase';
  var CLEAN = 'html[data-xf-clean] ';
  var ADS = 'html[data-xf-hideads] article[data-xf-ad]';
  var PAGE_CSS = [
    'html[data-xf-rootgrey]{filter:grayscale(1)!important;-webkit-filter:grayscale(1)!important}',
    'body{box-sizing:border-box!important;padding-top:var(--xf-h,0px)!important;padding-bottom:var(--xf-nb,0px)!important}',
    // Three-button bar: X's own bottom bar and the scrolling Home tab strip go.
    'html[data-xf-nav] [data-testid="BottomBar"]{display:none!important}',
    // Out of the way but still laid out, so X keeps handling its tabs.
    'html[data-xf-nav][data-xf-onhome]:not([data-xf-tabsshow]) [data-xf-tabs]{position:absolute!important;top:0!important;' +
      'left:0!important;right:0!important;opacity:0!important;pointer-events:none!important;z-index:-1!important}',
    'video,' + PLAYER_SEL + '{display:none!important}',
    '[data-xf-video]{' + STUB_BOX + ';position:relative!important;margin:4px 0!important}',
    '[data-xf-video]>*{display:none!important}',
    '[data-xf-video]::before{content:"Video hidden";' + STUB_LABEL + '}',
    'html[data-xf-hideposts] [data-xf-vpost]{display:none!important}',
    // An ad keeps its place in the feed but shows nothing of itself.
    ADS + '{' + STUB_BOX + ';margin:8px 12px!important;pointer-events:none!important}',
    ADS + '>*{display:none!important}',
    ADS + '::before{content:"Ad hidden";' + STUB_LABEL + '}',
    'a[href="/i/video"],a[href^="/i/video/"]{display:none!important}',
    // Clean mode: no Spaces, no Grok, no Premium upsells.
    CLEAN + '[data-xf-space]{' + STUB_BOX + ';position:relative!important;margin:4px 0!important}',
    CLEAN + '[data-xf-space]>*{display:none!important}',
    CLEAN + '[data-xf-space]::before{content:"Space hidden";' + STUB_LABEL + '}',
    CLEAN + '[data-xf-spacecell],' + CLEAN + '[data-testid^="SpaceDock"],' + CLEAN + 'a[href="/i/spaces"],' +
      CLEAN + 'a[href="/i/spaces/start"]{display:none!important}',
    CLEAN + '[data-testid="GrokDrawer"],' + CLEAN + 'a[href="/i/grok"],' +
      CLEAN + 'a[href^="/i/premium"],' + CLEAN + 'a[href="/i/verified-choose"],' +
      CLEAN + '[data-testid="super-upsell-UpsellCardRenderProperties"]{display:none!important}'
  ].join('\n');

  var FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  var UI_CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '[hidden]{display:none!important}',
    '.grey{position:fixed;top:0;right:0;bottom:0;left:0;pointer-events:none;' +
      '-webkit-backdrop-filter:grayscale(1);backdrop-filter:grayscale(1)}',
    '.bar{position:relative;background:#000;color:#fff;font-family:' + FONT + ';' +
      'padding:calc(env(safe-area-inset-top,0px) + 5px) 12px 7px;-webkit-user-select:none;user-select:none}',
    '.row{display:flex;align-items:center;gap:8px}',
    '.main{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:12px;background:none;border:0;color:inherit;' +
      'padding:0;margin:0;font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.time{font-size:42px;line-height:1;font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:var(--zone,#fff)}',
    '.meta{display:flex;flex-direction:column;gap:3px;min-width:0}',
    '.lbl{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;line-height:1}',
    '.sub{font-size:12px;font-weight:500;color:#b5b5b5;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.chip{flex:none;-webkit-appearance:none;appearance:none;border:1.5px solid #fff;background:transparent;color:#fff;' +
      'font:800 11px/1 ' + FONT + ';letter-spacing:.08em;text-transform:uppercase;padding:9px 10px;border-radius:999px;' +
      'font-variant-numeric:tabular-nums;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.chip.on{background:#fff;color:#000}',
    '.segs{display:flex;gap:2px;margin-top:6px;height:6px}',
    '.seg{flex:1 1 0;min-width:0;background:#3d3d3d;position:relative;overflow:hidden;border-radius:1px}',
    '.seg b{position:absolute;top:0;right:0;bottom:0;left:0;background:#fff}',
    '.bar.low .time{animation:xfblink 1s steps(2,jump-none) infinite}',
    '.bar.flash{animation:xfflash .5s steps(2,jump-none) 5}',
    '@keyframes xfblink{50%{opacity:.25}}',
    '@keyframes xfflash{50%{background:#fff;color:#000}}',
    '.ov{position:fixed;top:0;right:0;bottom:0;left:0;background:#000;color:#fff;display:flex;flex-direction:column;' +
      'padding:calc(env(safe-area-inset-top,0px) + 24px) 24px calc(env(safe-area-inset-bottom,0px) + 24px);' +
      'overflow:auto;overscroll-behavior:contain;font-family:' + FONT + '}',
    '.in{margin:auto;display:flex;flex-direction:column;align-items:center;gap:16px;width:100%;max-width:320px;text-align:center}',
    '.big{font-size:min(44vw,200px);font-weight:900;line-height:.85;font-variant-numeric:tabular-nums;letter-spacing:-.04em}',
    '.cap{font-size:24px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;line-height:1.1}',
    '.cap.small{font-size:13px;letter-spacing:.14em;margin-top:8px}',
    '.txt{font-size:17px;line-height:1.4;max-width:30ch;color:#cfcfcf;margin:0}',
    '.note{font-size:14px;line-height:1.4;max-width:34ch;color:#9a9a9a;margin:0}',
    '.btn{-webkit-appearance:none;appearance:none;border:2px solid #fff;background:#fff;color:#000;' +
      'font:800 17px/1 ' + FONT + ';padding:17px 20px;border-radius:999px;width:100%;max-width:300px;cursor:pointer;' +
      '-webkit-tap-highlight-color:transparent}',
    '.btn.ghost{background:transparent;color:#fff}',
    '.btn:disabled{opacity:.4;cursor:default}',
    '.val{font-size:48px;font-weight:900;line-height:1;font-variant-numeric:tabular-nums}',
    '.slider{-webkit-appearance:none;appearance:none;width:100%;height:44px;margin:0;background:transparent;touch-action:none;cursor:pointer}',
    '.slider::-webkit-slider-runnable-track{height:6px;background:#3d3d3d;border-radius:3px}',
    '.slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:32px;height:32px;margin-top:-13px;border:0;border-radius:50%;background:#fff}',
    '.slider::-moz-range-track{height:6px;background:#3d3d3d;border-radius:3px}',
    '.slider::-moz-range-thumb{width:32px;height:32px;border:0;border-radius:50%;background:#fff}',
    '.ends{display:flex;justify-content:space-between;width:100%;font-size:12px;color:#9a9a9a;margin-top:-12px}',
    '.opts{display:flex;gap:8px;width:100%}',
    '.opts .btn{flex:1 1 0;padding:13px 0;font-size:15px;background:transparent;color:#fff;border-color:#5a5a5a}',
    '.opts .btn.sel{background:#fff;color:#000;border-color:#fff}',
    '.checks{display:flex;flex-direction:column;gap:14px;width:100%;margin-top:8px}',
    '.check{display:flex;align-items:center;gap:12px;font-size:16px;line-height:1.3;text-align:left;cursor:pointer}',
    '.check input{width:24px;height:24px;flex:none;accent-color:#fff;margin:0}',
    '.nav{position:fixed;left:0;right:0;bottom:0;display:flex;background:#000;border-top:1px solid #2a2a2a;' +
      'padding:0 env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);font-family:' + FONT + '}',
    '.nav button{flex:1 1 0;min-width:0;height:54px;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:4px;padding:0 6px;margin:0;background:none;border:0;color:#7d7d7d;font:600 11px/1 ' + FONT + ';cursor:pointer;' +
      '-webkit-tap-highlight-color:transparent}',
    '.nav button.on{color:#fff}',
    '.nav svg{display:block;width:24px;height:24px}',
    '.nav span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.go{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%}',
    '.dump{width:100%;height:180px;background:#111;color:#ddd;border:1px solid #444;border-radius:8px;padding:8px;' +
      'font:11px/1.4 ui-monospace,monospace;white-space:pre;overflow:auto}',
    '.go .btn{max-width:none;padding:14px 4px;font-size:13px;line-height:1.2;background:transparent;color:#fff;border-color:#5a5a5a}',
    '.week{display:flex;align-items:flex-end;gap:6px;width:100%}',
    '.day{flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;line-height:1;color:#9a9a9a;font-variant-numeric:tabular-nums}',
    '.day i{display:block;width:100%;background:#fff;border-radius:2px}',
    '.day.x i{background:#ff453a}',
    '@media (prefers-reduced-motion:reduce){.bar.low .time,.bar.flash{animation:none}}'
  ].join('\n');

  /* ------------------------------------------------------------------ */
  /* State + storage                                                     */
  /* ------------------------------------------------------------------ */

  var DEFAULTS = {
    limitMin: 0,          // 0 = not set up yet
    pendingLimitMin: 0,   // a raised limit waiting for tomorrow
    pendingFrom: '',
    colorMin: 5,          // minutes of colour per day (0 = off)
    hidePosts: false,     // hide whole posts that contain video
    hideAds: true,
    clean: true,          // hide Grok and Premium upsells
    blackBg: true,        // ask X for its pure-black theme
    nav: true,            // three buttons (Home, Following, first list) instead of X's bottom bar
    listName: '',         // name of the first pinned list, for its button
    weekSeen: '',         // day the weekly summary was last shown
    day: '',
    usedSec: 0,
    colorUsedSec: 0,
    ackCp: 0,             // last 5-minute check-in the user dismissed
    extraSec: 0,          // extra time taken after hitting the limit
    extCount: 0,
    ts: 0
  };
  var DAILY = ['usedSec', 'colorUsedSec', 'ackCp', 'extraSec', 'extCount'];

  var state = normalize(null);
  var loaded = false;
  var dirty = 0;

  function noop() {}

  function dayKey(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function todayKey() { return dayKey(new Date()); }
  function tomorrowKey() {
    var d = new Date();
    return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
  }

  function parse(s) {
    if (!s || typeof s !== 'string') return null;
    try { var o = JSON.parse(s); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
  }

  function normalize(o) {
    var out = {}, k;
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    if (o) {
      for (k in DEFAULTS) {
        if (o[k] === undefined || o[k] === null) continue;
        if (typeof DEFAULTS[k] === 'number') { var n = Number(o[k]); if (isFinite(n) && n >= 0) out[k] = n; }
        else if (typeof DEFAULTS[k] === 'boolean') out[k] = !!o[k];
        else out[k] = String(o[k]);
      }
    }
    if (out.limitMin > MAX_LIMIT) out.limitMin = MAX_LIMIT;
    if (out.pendingLimitMin > MAX_LIMIT) out.pendingLimitMin = MAX_LIMIT;
    out.hist = cleanHist(o && o.hist);
    return out;
  }

  // Per-day totals for past days: { 'YYYY-MM-DD': { u: seconds used, x: extra-time count, c: colour seconds } }.
  function cleanHist(h) {
    var out = {};
    if (!h || typeof h !== 'object') return out;
    Object.keys(h).filter(function (k) { return /^\d{4}-\d\d-\d\d$/.test(k) && h[k] && typeof h[k] === 'object'; })
      .sort().slice(-HIST_DAYS).forEach(function (k) {
        function num(v) { v = Number(v); return isFinite(v) && v > 0 ? Math.round(v) : 0; }
        out[k] = { u: num(h[k].u), x: num(h[k].x), c: num(h[k].c) };
      });
    return out;
  }

  // Newest settings win; for the same day the larger counters win, so a
  // second tab or a cleared site storage can never hand time back.
  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;
    var newer = (Number(a.ts) || 0) >= (Number(b.ts) || 0) ? a : b;
    var older = newer === a ? b : a;
    var out = normalize(newer);
    if (older.day && older.day === out.day) {
      DAILY.forEach(function (k) {
        var v = Number(older[k]);
        if (isFinite(v) && v > out[k]) out[k] = v;
      });
    }
    var oh = cleanHist(older.hist), all = {};
    Object.keys(oh).forEach(function (k) { all[k] = oh[k]; });
    Object.keys(out.hist).forEach(function (k) { all[k] = out.hist[k]; });
    out.hist = cleanHist(all);
    return out;
  }

  function gmGet() {
    try {
      if (NATIVE) return Promise.resolve(String(NATIVE.getValue(KEY) || ''));
      if (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function') {
        return Promise.resolve(GM.getValue(KEY, '')).catch(function () { return ''; });
      }
      if (typeof GM_getValue === 'function') return Promise.resolve(GM_getValue(KEY, ''));
    } catch (e) {}
    return Promise.resolve('');
  }
  function gmSet(s) {
    try {
      if (NATIVE) { NATIVE.setValue(KEY, s); return; }
      if (typeof GM !== 'undefined' && GM && typeof GM.setValue === 'function') {
        var p = GM.setValue(KEY, s);
        if (p && typeof p.catch === 'function') p.catch(noop);
      } else if (typeof GM_setValue === 'function') {
        GM_setValue(KEY, s);
      }
    } catch (e) {}
  }
  function lsGet() { try { return window.localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function lsSet(s) { try { window.localStorage.setItem(KEY, s); } catch (e) {} }

  function save() {
    if (!loaded) return;
    dirty = 0;
    state.ts = Date.now();
    var copy = normalize(state);
    copy.usedSec = Math.round(copy.usedSec * 10) / 10;
    copy.colorUsedSec = Math.round(copy.colorUsedSec * 10) / 10;
    var s = JSON.stringify(copy);
    gmSet(s);
    lsSet(s);
  }

  function loadState() {
    return gmGet().then(function (g) {
      var stored = merge(parse(g), parse(lsGet()));
      state = normalize(merge(stored, loaded ? state : null));
      loaded = true;
      rollover();
      applyFlags();
      ensureBlackTheme();
    });
  }

  // Returns true when a new day started.
  function rollover() {
    var today = todayKey();
    if (state.day === today) return false;
    if (state.day) {
      state.hist[state.day] = { u: state.usedSec, x: state.extCount, c: state.colorUsedSec };
      state.hist = cleanHist(state.hist);
    }
    state.day = today;
    DAILY.forEach(function (k) { state[k] = 0; });
    if (state.pendingLimitMin && state.pendingFrom && state.pendingFrom <= today) {
      state.limitMin = state.pendingLimitMin;
      state.pendingLimitMin = 0;
      state.pendingFrom = '';
    }
    save();
    return true;
  }

  function dateOf(key) {
    var p = key.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  // The last n days, oldest first; with today, or ending yesterday.
  function lastDays(n, withToday) {
    var out = [], now = new Date();
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i - (withToday ? 0 : 1));
      var k = dayKey(d);
      var rec = k === state.day ? { u: state.usedSec, x: state.extCount } : (state.hist[k] || { u: 0, x: 0 });
      out.push({ key: k, letter: 'SMTWTFS'.charAt(d.getDay()), u: rec.u || 0, x: rec.x || 0 });
    }
    return out;
  }

  // The weekly summary shows itself once every seven days.
  function weekDue() {
    if (!state.weekSeen) { state.weekSeen = state.day; return false; }
    return Math.round((dateOf(state.day) - dateOf(state.weekSeen)) / 86400000) >= 7;
  }

  function budgetSec() { return state.limitMin * 60 + state.extraSec; }
  function remainingSec() { return Math.max(0, budgetSec() - state.usedSec); }
  function colorLeftSec() { return Math.max(0, state.colorMin * 60 - state.colorUsedSec); }

  // 0, 1 or 2: which third of the day's limit a moment falls in.
  function zoneAt(sec) {
    var lim = state.limitMin * 60;
    if (!lim) return 0;
    var f = sec / lim;
    return f < 1 / 3 ? 0 : f < 2 / 3 ? 1 : 2;
  }

  // Colour for the stretch of the day from a to b seconds. A block that
  // crosses a third is split at exactly that point.
  function blockPaint(a, b) {
    var lim = state.limitMin * 60, cuts = [lim / 3, 2 * lim / 3], parts = [], from = a;
    for (var i = 0; i < cuts.length; i++) {
      if (cuts[i] > from + 0.5 && cuts[i] < b - 0.5) { parts.push([from, cuts[i]]); from = cuts[i]; }
    }
    parts.push([from, b]);
    if (parts.length === 1) return ZONES[zoneAt((a + b) / 2)];
    function pct(x) { return ((x - a) / (b - a) * 100).toFixed(1) + '%'; }
    return 'linear-gradient(to right, ' + parts.map(function (p) {
      return ZONES[zoneAt((p[0] + p[1]) / 2)] + ' ' + pct(p[0]) + ' ' + pct(p[1]);
    }).join(', ') + ')';
  }

  /* ------------------------------------------------------------------ */
  /* Page styling (greyscale fallback, video and ad removal, clean mode) */
  /* ------------------------------------------------------------------ */

  var pageStyle = null, pageAdopted = false;

  function makeStyle(css) {
    var s = document.createElement('style');
    s.setAttribute('data-xfocus', '');
    s.textContent = css;
    return s;
  }
  // A site's content policy can refuse inline <style>; the sheet is then missing.
  function cssApplied(styleEl) {
    try { return !!(styleEl.sheet && styleEl.sheet.cssRules.length); } catch (e) { return true; }
  }
  function adopt(root, css) {
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = Array.prototype.slice.call(root.adoptedStyleSheets || []).concat([sheet]);
      return true;
    } catch (e) { return false; }
  }

  function ensurePageStyle() {
    var root = document.documentElement;
    if (!root || pageAdopted) return;
    if (!pageStyle) pageStyle = makeStyle(PAGE_CSS);
    if (!pageStyle.isConnected) {
      (document.head || root).appendChild(pageStyle);
      if (!cssApplied(pageStyle) && adopt(document, PAGE_CSS)) {
        pageAdopted = true;
        pageStyle.remove();
      }
    }
  }

  function flag(name, on) {
    var root = document.documentElement;
    if (!root) return;
    if (on) { if (!root.hasAttribute(name)) root.setAttribute(name, ''); }
    else if (root.hasAttribute(name)) root.removeAttribute(name);
  }

  var loggedIn = false;
  function checkLoggedIn() {
    if (loggedIn) return true;
    try {
      if (/(^|;\s*)twid=/.test(document.cookie) ||
          document.querySelector('[data-testid="AppTabBar_Home_Link"], [data-testid="DashButton_ProfileIcon_Link"]')) {
        loggedIn = true;
      }
    } catch (e) {}
    return loggedIn;
  }

  function applyFlags() {
    flag('data-xf-hideposts', state.hidePosts);
    flag('data-xf-hideads', state.hideAds);
    flag('data-xf-clean', state.clean && checkLoggedIn());
    flag('data-xf-nav', state.nav && loggedIn);
    flag('data-xf-onhome', window.location.pathname === '/home');
  }

  /* ------------------------------------------------------------------ */
  /* Home tabs: For you, Following and the first pinned list             */
  /* ------------------------------------------------------------------ */

  var pendingTab = null;

  function homeTablist() {
    if (window.location.pathname !== '/home') return null;
    return document.querySelector('[data-testid="primaryColumn"] [role="tablist"]') ||
      document.querySelector('main [role="tablist"]') || document.querySelector('[role="tablist"]');
  }

  function homeTabs() {
    var list = homeTablist();
    return list ? list.querySelectorAll('[role="tab"]') : [];
  }

  // Which of the three buttons matches the current view, or -1.
  function activeTab() {
    if (window.location.pathname !== '/home') return -1;
    var tabs = homeTabs();
    for (var i = 0; i < tabs.length && i < 3; i++) if (tabs[i].getAttribute('aria-selected') === 'true') return i;
    return tabs.length ? -1 : 0;
  }

  // Marks the strip of Home tabs (and the wrappers that hold only it) so it
  // can be hidden; also learns the first list's name for its button.
  function scanTabs() {
    var list = homeTablist();
    if (!list) return;
    var tabs = list.querySelectorAll('[role="tab"]');
    if (tabs[2]) {
      var name = (tabs[2].textContent || '').trim();
      if (name && name.length <= 40 && name !== state.listName) { state.listName = name; save(); }
    }
    if (list.closest('[data-xf-tabs]')) return;
    var base = list.querySelectorAll(STRIP_SEL).length, cur = list;
    for (var n = 0; n < 6; n++) {
      var p = cur.parentElement;
      if (!p || p === document.body || p.tagName === 'MAIN' || p.tagName === 'HEADER') break;
      if (p.getAttribute('data-testid') === 'primaryColumn') break;
      var pos = window.getComputedStyle(p).position;
      if (pos === 'sticky' || pos === 'fixed') break;
      if (p.querySelectorAll(STRIP_SEL).length !== base) break;
      cur = p;
    }
    cur.setAttribute('data-xf-tabs', '');
  }

  var tabsShown = false, lastTabTry = '';

  // A tap as X's buttons expect it: pointer and mouse down/up, then click,
  // on the innermost element, so a handler on any wrapper inside the tab fires.
  function pressTab(tab) {
    var spans = tab.querySelectorAll('span');
    var target = spans.length ? spans[spans.length - 1] : tab;
    var r = target.getBoundingClientRect();
    var base = { bubbles: true, cancelable: true, composed: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1 };
    function fire(Ctor, type, extra) {
      var o = {}, k;
      for (k in base) o[k] = base[k];
      for (k in extra || {}) o[k] = extra[k];
      try { target.dispatchEvent(new Ctor(type, o)); } catch (e) {}
    }
    var P = window.PointerEvent || window.MouseEvent;
    var ptr = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    fire(P, 'pointerdown', ptr);
    fire(window.MouseEvent, 'mousedown');
    ptr.buttons = 0;
    fire(P, 'pointerup', ptr);
    fire(window.MouseEvent, 'mouseup', { buttons: 0 });
    fire(window.MouseEvent, 'click', { buttons: 0 });
  }

  function tabSelected(i) {
    var t = homeTabs()[i];
    return !!t && t.getAttribute('aria-selected') === 'true';
  }

  function clickTab(i, attempt) {
    var tabs = homeTabs();
    if (!tabs.length) return false;
    if (i >= tabs.length) {
      note(i === 2 ? 'Pin a list in X to use this button' : 'That tab is missing');
      return true;
    }
    attempt = attempt || 1;
    if (attempt === 2) { tabsShown = true; flag('data-xf-tabsshow', true); }
    pressTab(tabs[i]);
    try { window.scrollTo(0, 0); } catch (e) {}
    setTimeout(function () {
      var ok = tabSelected(i);
      lastTabTry = 'tab ' + i + ', try ' + attempt + ': ' + (ok ? 'switched' : 'no change');
      if (attempt === 2) {
        setTimeout(function () { tabsShown = false; flag('data-xf-tabsshow', false); }, 400);
        if (!ok) note('Could not switch tabs. Settings \u2192 Copy page details');
      } else if (!ok) {
        clickTab(i, 2);
      }
      if (bar && loaded) render();
    }, 600);
    return true;
  }

  function openTab(i) {
    if (mode) return;
    endPeek();
    if (window.location.pathname === '/home' && clickTab(i)) { render(); return; }
    pendingTab = { i: i, until: Date.now() + 8000 };
    try { window.sessionStorage.setItem(PENDING_TAB, String(i)); } catch (e) {}
    if (window.location.pathname !== '/home') {
      var home = document.querySelector('[data-testid="AppTabBar_Home_Link"]');
      if (home) home.click();
      else window.location.assign('/home');
    }
  }

  // Finishes a button press that had to load Home first.
  function tryPendingTab() {
    if (!pendingTab) {
      try {
        var v = window.sessionStorage.getItem(PENDING_TAB);
        if (v !== null) pendingTab = { i: Number(v) || 0, until: Date.now() + 8000 };
      } catch (e) {}
    }
    if (!pendingTab) return;
    var done = Date.now() > pendingTab.until ||
      (window.location.pathname === '/home' && clickTab(pendingTab.i));
    if (!done) return;
    pendingTab = null;
    try { window.sessionStorage.removeItem(PENDING_TAB); } catch (e) {}
    if (bar && loaded) render();
  }

  function isHScroller(el) {
    if (el.scrollWidth <= el.clientWidth + 20) return false;
    var ox = window.getComputedStyle(el).overflowX;
    return ox === 'auto' || ox === 'scroll';
  }

  var NOT_CAROUSEL = 'article, [data-testid="cellInnerDiv"], [role="tab"]';

  // The live Spaces bar, and any other sideways-scrolling strip in the feed that is
  // not a post: the cell that holds it is hidden.
  function scanCarousels() {
    if (!state.clean) return;
    var col = document.querySelector('[data-testid="primaryColumn"]') || document.body;
    var cells = col.querySelectorAll('[data-testid="cellInnerDiv"]:not([data-xf-spacecell])');
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i], len = (cell.textContent || '').length;
      if (cell.__xfLen === len) continue;
      cell.__xfLen = len;
      if (cell.querySelector('article')) continue;
      var divs = cell.querySelectorAll('div');
      for (var j = 0; j < divs.length && j < 400; j++) {
        if (isHScroller(divs[j]) && !divs[j].querySelector('[role="tab"]')) {
          cell.setAttribute('data-xf-spacecell', '');
          break;
        }
      }
    }
    // A strip that sits above the feed rather than in it.
    if (window.scrollY > 4 || !document.elementsFromPoint) return;
    var w = window.innerWidth, seen = new Set();
    for (var y = barH + 40; y < barH + 300; y += 25) {
      for (var x = w * 0.3; x <= w * 0.7; x += w * 0.4) {
        var els;
        try { els = document.elementsFromPoint(x, y); } catch (e) { els = []; }
        for (var k = 0; k < els.length && k < 6; k++) {
          for (var el = els[k]; el && el !== document.body && el !== col; el = el.parentElement) {
            if (seen.has(el)) break;
            seen.add(el);
            if (el === host || el.closest('article, [data-xf-tabs], [data-xf-spacecell]')) break;
            if (!isHScroller(el) || el.querySelector(NOT_CAROUSEL)) continue;
            var cur = el, base = el.querySelectorAll(STRIP_SEL).length;
            for (var n = 0; n < 6; n++) {
              var p = cur.parentElement;
              if (!p || p === col || p === document.body || p.querySelector(NOT_CAROUSEL)) break;
              var pos = window.getComputedStyle(p).position;
              if (pos === 'fixed' || pos === 'sticky' || p.querySelectorAll(STRIP_SEL).length !== base) break;
              cur = p;
            }
            cur.setAttribute('data-xf-spacecell', '');
            break;
          }
        }
      }
    }
  }

  // Space reserved for the hidden tab strip: a container that kept its height,
  // an empty spacer above the feed, or padding on the feed.
  var gapFixes = [];
  function setFix(el, prop, value) {
    var known = gapFixes.some(function (f) { return f.el === el && f.prop === prop; });
    if (!known) gapFixes.push({ el: el, prop: prop, orig: el.style.getPropertyValue(prop), prio: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, value, 'important');
  }
  function restoreGap() {
    gapFixes.forEach(function (f) {
      if (f.orig) f.el.style.setProperty(f.prop, f.orig, f.prio);
      else f.el.style.removeProperty(f.prop);
    });
    gapFixes = [];
  }
  function hasContent(el) {
    return !!((el.textContent || '').trim() || el.querySelector('img, svg, video, canvas, a, button, [role="button"]'));
  }

  function fixGap() {
    var strip = document.querySelector('[data-xf-tabs]');
    var active = strip && state.nav && loggedIn && window.location.pathname === '/home' && !tabsShown;
    if (!active) { if (gapFixes.length) restoreGap(); return; }
    if (window.scrollY > 4) return;
    var head = null, e, n;
    for (e = strip.parentElement, n = 0; e && e !== document.body && n < 8; e = e.parentElement, n++) {
      if (e.style.height) setFix(e, 'height', 'auto');
      var pos = window.getComputedStyle(e).position;
      if (pos === 'fixed' || pos === 'sticky') { head = e; break; }
    }
    head = head || strip.parentElement;
    var col = strip.closest('[data-testid="primaryColumn"]') || document;
    var cells = col.querySelectorAll('[data-testid="cellInnerDiv"]'), first = null, firstTop = 0;
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].getBoundingClientRect();
      if (r.height > 0) { first = cells[i]; firstTop = r.top; break; }
    }
    if (!first) return;
    var bottom = 0;
    var parts = head.querySelectorAll('img, svg, a, button, [role="button"], h1, h2, h3');
    for (i = 0; i < parts.length; i++) {
      if (parts[i].closest('[data-xf-tabs]')) continue;
      var pr = parts[i].getBoundingClientRect();
      if (pr.height > 0 && pr.bottom > bottom) bottom = pr.bottom;
    }
    if (!bottom) bottom = head.getBoundingClientRect().bottom;
    var gap = Math.round(firstTop - bottom - 14);
    if (gap < 10 || gap > 300) return;
    for (var a = first; a && a.parentElement && a !== document.body; a = a.parentElement) {
      for (var sib = a.previousElementSibling; sib; sib = sib.previousElementSibling) {
        var sr = sib.getBoundingClientRect();
        if (sr.height >= gap && sr.bottom <= firstTop + 1 && !hasContent(sib)) {
          setFix(sib, 'height', Math.round(sr.height - gap) + 'px');
          setFix(sib, 'min-height', '0px');
          return;
        }
      }
      var pt = parseFloat(window.getComputedStyle(a.parentElement).paddingTop) || 0;
      if (pt >= gap) { setFix(a.parentElement, 'padding-top', Math.round(pt - gap) + 'px'); return; }
    }
  }

  // Spaces: a Space card in a post becomes a stub; anything else about Spaces goes.
  function scanSpaces() {
    var links = document.querySelectorAll('a[href*="/i/spaces/"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.closest('[data-xf-space], [data-xf-spacecell], [data-testid="tweetText"]')) continue;
      if (a.closest('article')) {
        (a.closest('[data-testid="card.wrapper"]') || a).setAttribute('data-xf-space', '');
      } else {
        var cell = a.closest('[data-testid="cellInnerDiv"]');
        if (cell) cell.setAttribute('data-xf-spacecell', '');
      }
    }
  }

  // The layer-based greyscale covers the page only while the timer is shown.
  // Everywhere else (before it mounts, sign-in screens, old browsers) the
  // whole page is filtered instead.
  var layerGrey = false;
  function syncGrey() {
    var useLayer = !!(BACKDROP_OK && greyEl && host && host.isConnected && host.style.display !== 'none');
    flag('data-xf-rootgrey', !useLayer);
    if (useLayer !== layerGrey) {
      layerGrey = useLayer;
      // The app greys the whole view itself until the layer has taken over.
      try { if (NATIVE && typeof NATIVE.setGrey === 'function') NATIVE.setGrey(!useLayer); } catch (e) {}
    }
  }

  // X keeps its theme in a cookie: 2 is "Lights out", true black.
  function ensureBlackTheme() {
    if (!state.blackBg) return;
    try {
      if (/(^|;\s*)night_mode=2(;|$)/.test(document.cookie)) return;
      var base = window.location.hostname.replace(/^(mobile|www)\./, '');
      document.cookie = 'night_mode=2; path=/; domain=.' + base + '; max-age=31536000; secure';
    } catch (e) {}
  }

  function quiet(v) {
    try {
      v.muted = true;
      v.autoplay = false;
      v.preload = 'none';
      if (!v.paused) v.pause();
    } catch (e) {}
  }

  // Climb from the player through wrappers that hold nothing but the video,
  // so the whole media box collapses instead of leaving an empty frame.
  function mediaWrapper(player) {
    var baseText = (player.textContent || '').length;
    var baseCount = player.querySelectorAll(CONTENT_SEL).length + (player.matches(CONTENT_SEL) ? 1 : 0);
    var cur = player;
    for (var n = 0; n < 12; n++) {
      var p = cur.parentElement;
      if (!p || p === document.body || p === document.documentElement) break;
      if (p.tagName === 'ARTICLE' || p.id === 'react-root' || p.id === 'layers') break;
      if (p.getAttribute('data-testid') === 'cellInnerDiv') break;
      if ((p.textContent || '').length !== baseText) break;
      if (p.querySelectorAll(CONTENT_SEL).length + (p.matches(CONTENT_SEL) ? 1 : 0) !== baseCount) break;
      cur = p;
    }
    return cur;
  }

  function scanVideos() {
    var nodes = document.querySelectorAll(VIDEO_SEL);
    var i, el;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el.tagName === 'VIDEO') quiet(el);
      if (el.parentElement && el.parentElement.closest(PLAYER_SEL)) continue; // handled via its outer player
      if (el.closest('[data-xf-video]')) {
        markPost(el);
        continue;
      }
      var wrap = mediaWrapper(el);
      if (wrap.tagName !== 'VIDEO') wrap.setAttribute('data-xf-video', '');
      markPost(el);
    }
    // Drop marks whose video has gone away.
    var marked = document.querySelectorAll('[data-xf-video], [data-xf-vpost]');
    for (i = 0; i < marked.length; i++) {
      el = marked[i];
      if (!el.querySelector(VIDEO_SEL)) {
        el.removeAttribute('data-xf-video');
        el.removeAttribute('data-xf-vpost');
      }
    }
  }

  function markPost(el) {
    var post = el.closest('[data-testid="cellInnerDiv"]') || el.closest('article');
    if (post && !post.hasAttribute('data-xf-vpost')) post.setAttribute('data-xf-vpost', '');
  }

  // A promoted post is wrapped in X's ad-tracking element, or carries a bare
  // "Ad" label outside the post's own text and author name.
  function isAd(cell, art) {
    var track = art.closest('[data-testid="placementTracking"]');
    if (track && cell.contains(track)) return true;
    var spans = art.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i];
      if (s.childElementCount) continue;
      var t = s.textContent;
      if (t !== 'Ad' && t !== 'Promoted') continue;
      if (s.closest('[data-testid="tweetText"], [data-testid="User-Name"], [data-testid="socialContext"], a')) continue;
      return true;
    }
    return false;
  }

  function scanAds() {
    var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    for (var i = 0; i < cells.length; i++) {
      var art = cells[i].querySelector('article');
      if (!art) continue;
      var ad = isAd(cells[i], art);
      if (ad && !art.hasAttribute('data-xf-ad')) art.setAttribute('data-xf-ad', '');
      else if (!ad && art.hasAttribute('data-xf-ad')) art.removeAttribute('data-xf-ad');
    }
  }

  // Stop playback even if a player slips past the CSS.
  ['play', 'playing', 'canplay', 'loadeddata'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      var v = e.target;
      if (v && (v.tagName === 'VIDEO' || v.tagName === 'AUDIO')) quiet(v);
    }, true);
  });
  try {
    var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    if (proto && typeof proto.play === 'function') {
      var origPlay = proto.play;
      proto.play = function () {
        // No video, and no audio either: the only sound on X is Spaces.
        if (this && (this.tagName === 'VIDEO' || this.tagName === 'AUDIO')) {
          return Promise.reject(new DOMException('Video and audio are turned off by X Focus', 'NotAllowedError'));
        }
        return origPlay.apply(this, arguments);
      };
    }
  } catch (e) {}

  /* ------------------------------------------------------------------ */
  /* Keeping X's own top bar and full-screen sheets below the timer      */
  /* ------------------------------------------------------------------ */

  var barH = 0;

  function setTop(el, px) {
    el.style.setProperty('top', 'calc(' + px + 'px + var(--xf-h, 0px))', 'important');
  }

  function fixTop(el) {
    var orig = el.getAttribute('data-xf-top');
    if (orig !== null) {
      if (el.style.getPropertyValue('top').indexOf('--xf-h') < 0) setTop(el, parseFloat(orig) || 0);
      return;
    }
    var cs = window.getComputedStyle(el);
    var pos = cs.position;
    if (pos !== 'sticky' && pos !== 'fixed') return;
    var t = parseFloat(cs.top);
    if (isNaN(t) || t < -1 || t >= barH) return;
    if (pos === 'fixed') {
      var r = el.getBoundingClientRect();
      if (r.height < 1 || r.top >= barH) return;
    }
    el.setAttribute('data-xf-top', String(t));
    setTop(el, t);
    if (pos === 'fixed') {
      var r2 = el.getBoundingClientRect();
      if (r2.bottom > window.innerHeight + 1) {
        el.style.setProperty('max-height', 'calc(100% - var(--xf-h, 0px))', 'important');
      }
    }
  }

  // Floating buttons that sat on X's bottom bar (compose) move up above ours.
  function fixBottom(el) {
    if (el.hasAttribute('data-xf-bot')) {
      if (el.style.getPropertyValue('bottom').indexOf('--xf-nb') < 0) {
        el.style.setProperty('bottom', 'calc(' + el.getAttribute('data-xf-bot') + 'px + var(--xf-nb, 0px))', 'important');
      }
      return;
    }
    var cs = window.getComputedStyle(el);
    if (cs.position !== 'fixed') return;
    var b = parseFloat(cs.bottom), r = el.getBoundingClientRect();
    if (isNaN(b) || b >= navH || r.width > window.innerWidth * 0.5 || r.height < 1) return;
    el.setAttribute('data-xf-bot', String(b));
    el.style.setProperty('bottom', 'calc(' + b + 'px + var(--xf-nb, 0px))', 'important');
  }

  function adjustBottom() {
    if (navH <= 0 || !document.elementsFromPoint) return;
    var w = window.innerWidth, y = window.innerHeight - navH / 2, seen = new Set();
    for (var x = w * 0.1; x <= w * 0.95; x += w * 0.2) {
      var els;
      try { els = document.elementsFromPoint(x, y); } catch (e) { els = []; }
      for (var k = 0; k < els.length && k < 8; k++) {
        for (var el = els[k]; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
          if (seen.has(el)) break;
          seen.add(el);
          if (el !== host) fixBottom(el);
        }
      }
    }
  }

  function adjustLayout() {
    try { adjustBottom(); } catch (e) {}
    if (!barH || !document.elementsFromPoint || !host || host.style.display === 'none') return;
    var w = window.innerWidth;
    var xs = [w * 0.1, w * 0.5, w * 0.9];
    var ys = [2, barH / 2, barH + 3, barH + 40];
    var seen = new Set();
    for (var a = 0; a < xs.length; a++) {
      for (var b = 0; b < ys.length; b++) {
        var els;
        try { els = document.elementsFromPoint(xs[a], ys[b]); } catch (e) { els = []; }
        for (var k = 0; k < els.length && k < 8; k++) {
          var el = els[k];
          while (el && el !== document.body && el !== document.documentElement) {
            if (seen.has(el)) break;
            seen.add(el);
            if (el !== host) fixTop(el);
            el = el.parentElement;
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Timer bar + overlays                                                */
  /* ------------------------------------------------------------------ */

  var host = null, ui = null, uiStyle = null, uiCssChecked = false;
  var greyEl = null, bar = null, timeEl = null, subEl = null, segsEl = null, colorChip = null, ov = null, ovIn = null;
  var navEl = null, navBtns = [], navH = -1;
  var segFills = [], segKey = '';
  var mode = null, modeArg = null, overlayTick = null;
  var noteText = '', noteUntil = 0;

  function h(tag, attrs, kids) {
    var e = document.createElement(tag), k;
    if (attrs) {
      for (k in attrs) {
        if (k === 'text') e.textContent = attrs[k];
        else if (k === 'class') e.className = attrs[k];
        else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
        else e.setAttribute(k, attrs[k]);
      }
    }
    if (kids) for (var i = 0; i < kids.length; i++) if (kids[i]) e.appendChild(kids[i]);
    return e;
  }

  function buildUi() {
    host = document.createElement('div');
    host.setAttribute('data-xfocus', '');
    var hs = host.style;
    hs.setProperty('position', 'fixed', 'important');
    hs.setProperty('top', '0', 'important');
    hs.setProperty('left', '0', 'important');
    hs.setProperty('right', '0', 'important');
    hs.setProperty('z-index', '2147483647', 'important');
    hs.setProperty('display', 'block', 'important');
    hs.setProperty('margin', '0', 'important');
    try { ui = host.attachShadow({ mode: 'open' }); } catch (e) { ui = host; }

    uiStyle = makeStyle(UI_CSS);

    timeEl = h('span', { class: 'time', text: '--:--' });
    subEl = h('span', { class: 'sub', text: '' });
    segsEl = h('div', { class: 'segs' });
    colorChip = h('button', { class: 'chip on', type: 'button', hidden: '', 'aria-label': 'Stop showing colour', onclick: function () { endPeek(); } });
    bar = h('div', { class: 'bar' }, [
      h('div', { class: 'row' }, [
        h('button', { class: 'main', type: 'button', 'aria-label': 'Time left today. Open settings.', onclick: onBarTap }, [
          timeEl,
          h('span', { class: 'meta' }, [h('span', { class: 'lbl', text: 'left today' }), subEl])
        ]),
        colorChip
      ]),
      segsEl
    ]);
    navEl = h('div', { class: 'nav', role: 'navigation', 'aria-label': 'Timelines', hidden: '' });
    navBtns = [0, 1, 2].map(function (i) {
      var label = h('span', { text: '' });
      var b = h('button', { type: 'button', onclick: function () { openTab(i); } }, [navIcon(i), label]);
      navEl.appendChild(b);
      return { el: b, label: label };
    });
    ovIn = h('div', { class: 'in' });
    ov = h('div', { class: 'ov', hidden: '' }, [ovIn]);

    ui.appendChild(uiStyle);
    if (BACKDROP_OK) {
      greyEl = h('div', { class: 'grey' });
      ui.appendChild(greyEl);
    }
    ui.appendChild(bar);
    ui.appendChild(navEl);
    ui.appendChild(ov);
  }

  // House, two people, and a list: drawn with plain strokes.
  function navIcon(i) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var shapes = [
      [['path', { d: 'M3.5 10.5 12 3.8l8.5 6.7V20a.5.5 0 0 1-.5.5h-5.2v-6.3H9.2v6.3H4a.5.5 0 0 1-.5-.5z' }]],
      [['circle', { cx: '9', cy: '8', r: '3.3' }], ['path', { d: 'M2.8 20c.4-3.6 3-5.8 6.2-5.8s5.8 2.2 6.2 5.8' }],
        ['path', { d: 'M15.4 4.9a3.1 3.1 0 0 1 0 6' }], ['path', { d: 'M17.6 14.4c2 .7 3.3 2.7 3.6 5.6' }]],
      [['path', { d: 'M9 6h11.5M9 12h11.5M9 18h11.5' }], ['circle', { cx: '4.3', cy: '6', r: '1.2', fill: 'currentColor', stroke: 'none' }],
        ['circle', { cx: '4.3', cy: '12', r: '1.2', fill: 'currentColor', stroke: 'none' }],
        ['circle', { cx: '4.3', cy: '18', r: '1.2', fill: 'currentColor', stroke: 'none' }]]
    ][i];
    shapes.forEach(function (sh) {
      var el = document.createElementNS(NS, sh[0]);
      for (var k in sh[1]) el.setAttribute(k, sh[1][k]);
      svg.appendChild(el);
    });
    return svg;
  }

  function renderNav() {
    var show = !!(state.nav && loggedIn && host && host.style.display !== 'none');
    navEl.hidden = !show;
    if (show) {
      var names = ['Home', 'Following', state.listName || 'List'], on = activeTab();
      for (var i = 0; i < navBtns.length; i++) {
        if (navBtns[i].label.textContent !== names[i]) navBtns[i].label.textContent = names[i];
        navBtns[i].el.classList.toggle('on', i === on);
        if (i === on) navBtns[i].el.setAttribute('aria-current', 'page');
        else navBtns[i].el.removeAttribute('aria-current');
      }
    }
    var hgt = show ? navEl.offsetHeight : 0;
    if (hgt !== navH) {
      navH = hgt;
      document.documentElement.style.setProperty('--xf-nb', hgt + 'px');
    }
  }

  function ensureMounted() {
    ensurePageStyle();
    if (!document.body) return false;
    if (!host) buildUi();
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (!uiCssChecked) {
      uiCssChecked = true;
      if (!cssApplied(uiStyle)) adopt(ui.adoptedStyleSheets ? ui : document, UI_CSS);
    }
    return true;
  }

  function setBarVisible(on) {
    host.style.setProperty('display', on ? 'block' : 'none', 'important');
    var hgt = on ? bar.offsetHeight : 0;
    if (hgt !== barH || !on) {
      barH = hgt;
      document.documentElement.style.setProperty('--xf-h', barH + 'px');
    }
    syncGrey();
  }

  function fmt(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return (hh ? hh + ':' : '') + p(mm) + ':' + p(ss);
  }

  function note(text) {
    noteText = text;
    noteUntil = Date.now() + 3500;
    if (subEl) subEl.textContent = text;
  }

  function render() {
    renderNav();
    colorChip.hidden = !peek;
    if (peek) colorChip.textContent = 'Colour ' + fmt(colorLeftSec()) + ' ×';

    if (!state.limitMin) {
      timeEl.textContent = '--:--';
      subEl.textContent = 'set a daily limit';
      return;
    }
    var budget = budgetSec(), rem = remainingSec(), used = Math.min(state.usedSec, budget);
    timeEl.textContent = fmt(rem);
    subEl.textContent = Date.now() < noteUntil ? noteText
      : Math.floor(used / 60) + ' of ' + Math.round(budget / 60) + ' min used';
    bar.style.setProperty('--zone', ZONES[zoneAt(used)]);

    // One block per 10 minutes; a shorter last block is drawn narrower.
    var n = Math.max(1, Math.ceil(budget / BLOCK));
    var key = budget + '/' + state.limitMin;
    if (segKey !== key) {
      segKey = key;
      while (segsEl.firstChild) segsEl.removeChild(segsEl.firstChild);
      segFills = [];
      for (var i = 0; i < n; i++) {
        var from = i * BLOCK, to = Math.min(budget, from + BLOCK);
        var fill = document.createElement('b');
        fill.style.background = blockPaint(from, to);
        var seg = h('i', { class: 'seg' }, [fill]);
        seg.style.flexGrow = String(Math.max(1, to - from));
        segsEl.appendChild(seg);
        segFills.push({ el: fill, from: from, len: Math.max(1, to - from) });
      }
    }
    for (var j = 0; j < segFills.length; j++) {
      var f = segFills[j];
      var spent = Math.min(1, Math.max(0, (state.usedSec - f.from) / f.len));
      var clip = 'inset(0 0 0 ' + (spent * 100).toFixed(1) + '%)';
      f.el.style.clipPath = clip;
      f.el.style.webkitClipPath = clip;
    }
    bar.classList.toggle('low', rem > 0 && rem <= STEP);
  }

  function flashBar() {
    bar.classList.remove('flash');
    void bar.offsetWidth;
    bar.classList.add('flash');
    setTimeout(function () { bar.classList.remove('flash'); }, 2800);
    try { if (navigator.vibrate) navigator.vibrate([180, 90, 180]); } catch (e) {}
  }

  function show(m, arg) {
    if (mode === m && modeArg === arg) return;
    mode = m;
    modeArg = arg;
    overlayTick = null;
    while (ovIn.firstChild) ovIn.removeChild(ovIn.firstChild);
    if (!m) { ov.hidden = true; return; }
    endPeek();
    var kids = m === 'setup' ? buildSetup()
      : m === 'gate' ? buildGate()
      : m === 'week' ? buildWeek()
      : m === 'checkpoint' ? buildCheckpoint(arg)
      : m === 'lock' ? buildLock()
      : m === 'settings' ? buildSettings()
      : buildBye();
    for (var i = 0; i < kids.length; i++) if (kids[i]) ovIn.appendChild(kids[i]);
    ov.hidden = false;
    ov.scrollTop = 0;
  }

  function onBarTap() {
    if (!loaded || mode) return;
    if (!state.limitMin) return;
    show('settings');
  }

  // A 5-to-90-minute slider in 5-minute steps. onChange gets the new value.
  function limitSlider(value, onChange) {
    var val = h('div', { class: 'val', text: value + ' min' });
    var input = h('input', {
      class: 'slider', type: 'range', id: 'xf-limit', min: String(MIN_LIMIT), max: String(MAX_LIMIT),
      step: String(LIMIT_STEP), 'aria-label': 'Minutes of X per day'
    });
    input.value = String(value);
    input.addEventListener('input', function () {
      var v = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(Number(input.value) / LIMIT_STEP) * LIMIT_STEP));
      val.textContent = v + ' min';
      onChange(v);
    });
    var ends = h('div', { class: 'ends' }, [h('span', { text: MIN_LIMIT + ' min' }), h('span', { text: MAX_LIMIT + ' min' })]);
    return [val, input, ends];
  }

  function buildSetup() {
    var draft = DEFAULT_LIMIT;
    return [h('div', { class: 'cap', text: 'Minutes of X per day' })]
      .concat(limitSlider(draft, function (v) { draft = v; }))
      .concat([
        h('button', {
          class: 'btn', type: 'button', text: 'Start',
          onclick: function () {
            state.limitMin = draft;
            state.pendingLimitMin = 0;
            state.pendingFrom = '';
            save();
            show(null);
            render();
          }
        }),
        h('p', { class: 'note', text: 'The clock runs only while X is on screen. You can lower the limit any time; raising it only takes effect the next day.' })
      ]);
  }

  // Shown for a few seconds every time X is opened.
  function buildGate() {
    var endAt = Date.now() + GATE_WAIT * 1000;
    var big = h('div', { class: 'big', text: String(GATE_WAIT) });
    big.style.color = ZONES[zoneAt(Math.min(state.usedSec, budgetSec()))];
    overlayTick = function () {
      var s = Math.ceil((endAt - Date.now()) / 1000);
      if (s <= 0) { show(null); return; }
      big.textContent = String(s);
    };
    return [
      big,
      h('div', { class: 'cap', text: 'Opening X' }),
      h('p', { class: 'txt', text: Math.ceil(remainingSec() / 60) + ' min left today. What are you here for?' }),
      h('button', { class: 'btn ghost', type: 'button', text: 'Not now', onclick: function () { show('bye'); } })
    ];
  }

  // Seven bars, one per day, plus the totals. Days with extra time taken are red.
  function weekView(days) {
    var max = 1, total = 0, extra = 0, i;
    for (i = 0; i < days.length; i++) { max = Math.max(max, days[i].u); total += days[i].u; extra += days[i].x; }
    var chart = h('div', { class: 'week', role: 'img', 'aria-label': 'Minutes of X per day' });
    for (i = 0; i < days.length; i++) {
      var barEl = document.createElement('i');
      barEl.style.height = Math.max(2, Math.round(days[i].u / max * 64)) + 'px';
      chart.appendChild(h('div', { class: 'day' + (days[i].x ? ' x' : '') }, [
        h('span', { text: String(Math.round(days[i].u / 60)) }), barEl, h('span', { text: days[i].letter })
      ]));
    }
    var mins = Math.round(total / 60);
    return [chart, h('p', { class: 'note', text: mins + ' min in 7 days \u00b7 ' + Math.round(mins / 7) +
      ' a day \u00b7 extra time taken ' + extra + '\u00d7' })];
  }

  function buildWeek() {
    return [h('div', { class: 'cap', text: 'Your week on X' })]
      .concat(weekView(lastDays(7, false)))
      .concat([h('button', {
        class: 'btn', type: 'button', text: 'OK',
        onclick: function () { state.weekSeen = state.day; save(); show(null); }
      })]);
  }

  function buildCheckpoint(cp) {
    var gone = Math.round(cp * STEP / 60);
    var left = Math.ceil(remainingSec() / 60);
    var readyAt = Date.now() + CHECK_WAIT * 1000;
    var go = h('button', { class: 'btn ghost', type: 'button', disabled: '' });
    function upd() {
      var s = Math.ceil((readyAt - Date.now()) / 1000);
      if (s > 0) { go.disabled = true; go.textContent = 'Keep going in ' + s + 's'; }
      else { go.disabled = false; go.textContent = 'Keep going'; }
    }
    go.addEventListener('click', function () {
      if (go.disabled) return;
      state.ackCp = Math.max(state.ackCp, cp);
      save();
      show(null);
    });
    overlayTick = upd;
    upd();
    flashBar();
    var big = h('div', { class: 'big', text: String(gone) });
    big.style.color = ZONES[zoneAt(Math.min(state.usedSec, budgetSec()))];
    return [
      big,
      h('div', { class: 'cap', text: 'minutes gone' }),
      h('p', { class: 'txt', text: left + ' min left today. Is this still useful, or just scrolling?' }),
      h('button', { class: 'btn', type: 'button', text: 'I’m done', onclick: function () { save(); show('bye'); } }),
      go,
      h('p', { class: 'note', text: 'Your clock is paused while this screen is up.' })
    ];
  }

  function buildLock() {
    var wait = Math.min(30 * (state.extCount + 1), 120);
    var readyAt = 0;
    var more = h('button', { class: 'btn ghost', type: 'button', text: 'I need 5 more minutes' });
    function upd() {
      if (!readyAt) return;
      var s = Math.ceil((readyAt - Date.now()) / 1000);
      if (s > 0) { more.disabled = true; more.textContent = 'Wait ' + s + 's'; }
      else { more.disabled = false; more.textContent = 'Take 5 more minutes'; }
    }
    more.addEventListener('click', function () {
      if (more.disabled) return;
      if (!readyAt) { readyAt = Date.now() + wait * 1000; upd(); return; }
      if (Date.now() < readyAt) return;
      state.extraSec = Math.max(state.extraSec, state.usedSec - state.limitMin * 60) + STEP;
      state.extCount += 1;
      state.ackCp = Math.floor(state.usedSec / STEP);
      save();
      show(null);
      render();
    });
    overlayTick = upd;
    flashBar();
    var cap = h('div', { class: 'cap', text: 'Time’s up' });
    cap.style.color = ZONES[2];
    return [
      cap,
      h('p', { class: 'txt', text: 'You have used your ' + state.limitMin + ' minutes of X for today. It opens again tomorrow.' }),
      more,
      h('p', { class: 'note', text: state.extCount
        ? 'Extra time taken today: ' + state.extCount + ' × 5 min. The wait gets longer each time.'
        : 'Taking extra time means sitting through a ' + wait + '-second wait first.' })
    ];
  }

  function checkRow(id, label, checked) {
    var box = h('input', { type: 'checkbox', id: id });
    box.checked = !!checked;
    return { box: box, row: h('label', { class: 'check', for: id }, [box, h('span', { text: label })]) };
  }

  // One line per element: what it is, where it is, and anything layout-related.
  function describe(el) {
    var cs = window.getComputedStyle(el), r = el.getBoundingClientRect(), out = [el.tagName.toLowerCase()];
    function add(k, v) { if (v) out.push(k + '=' + String(v).replace(/\s+/g, ' ').slice(0, 40)); }
    add('t', el.getAttribute('data-testid'));
    add('role', el.getAttribute('role'));
    add('aria', el.getAttribute('aria-label'));
    add('sel', el.getAttribute('aria-selected'));
    add('href', el.getAttribute('href'));
    if (cs.position !== 'static' && cs.position !== 'relative') add('pos', cs.position + ' t' + cs.top + ' b' + cs.bottom);
    out.push('y' + Math.round(r.top) + ' h' + Math.round(r.height) + ' w' + Math.round(r.width));
    add('sh', el.style.height);
    add('tf', el.style.transform);
    if (cs.paddingTop !== '0px') add('pt', cs.paddingTop);
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') add('ox', cs.overflowX + ' sw' + el.scrollWidth);
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i].name;
      if (a.indexOf('data-xf-') === 0) add('xf', a.slice(8));
    }
    if (!el.childElementCount) add('txt', (el.textContent || '').trim());
    return out.join(' ');
  }

  function pageReport() {
    var L = [], n, e, i;
    L.push('X Focus ' + VERSION + ' path=' + window.location.pathname + ' scrollY=' + Math.round(window.scrollY) +
      ' view=' + window.innerWidth + 'x' + window.innerHeight + ' bar=' + barH + ' nav=' + navH +
      ' app=' + !!NATIVE + ' gapFixes=' + gapFixes.length);
    L.push('last tab press: ' + (lastTabTry || 'none'));
    var list = homeTablist();
    L.push('== tab strip and its parents');
    for (e = list, n = 0; e && e !== document.documentElement && n < 16; e = e.parentElement, n++) L.push(describe(e));
    L.push('== inside the first two tabs');
    var tabs = homeTabs();
    for (i = 0; i < tabs.length && i < 2; i++) {
      (function walk(el, d) {
        if (L.length > 400) return;
        L.push(new Array(d + 1).join(' ') + describe(el));
        for (var c = el.firstElementChild; c; c = c.nextElementSibling) walk(c, d + 1);
      })(tabs[i], 0);
    }
    L.push('== top of the page');
    var col = document.querySelector('[data-testid="primaryColumn"]') || document.body, count = 0;
    (function walk(el, d) {
      if (count > 260) return;
      var r = el.getBoundingClientRect();
      if (el !== col && (r.top > 520 || (r.bottom < -40 && r.height > 0))) return;
      count++;
      L.push(new Array(d + 1).join(' ') + describe(el));
      if (el.tagName === 'ARTICLE' || el.tagName === 'svg') return;
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) walk(c, d + 1);
    })(col, 0);
    L.push('== fixed things near the bottom');
    if (document.elementsFromPoint) {
      var seen = new Set();
      [0.15, 0.5, 0.85].forEach(function (fx) {
        [40, 100, 160].forEach(function (dy) {
          document.elementsFromPoint(window.innerWidth * fx, window.innerHeight - dy).forEach(function (el) {
            for (; el && el !== document.body; el = el.parentElement) {
              if (seen.has(el)) return;
              seen.add(el);
              if (window.getComputedStyle(el).position === 'fixed') L.push(describe(el));
            }
          });
        });
      });
    }
    return L.join('\n');
  }

  function reportButton() {
    var b = h('button', { class: 'btn ghost', type: 'button', text: 'Copy page details for Claude' });
    b.addEventListener('click', function () {
      var text = pageReport();
      var box = h('textarea', { class: 'dump', readonly: '', 'aria-label': 'Page details' });
      box.value = text;
      b.parentNode.insertBefore(box, b.nextSibling);
      function done(ok) {
        b.textContent = ok ? 'Copied. Paste it into the chat' : 'Select the text below and copy it';
      }
      function fallback() {
        var ok = false;
        try { box.focus(); box.select(); ok = document.execCommand('copy'); } catch (e) {}
        done(ok);
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
          return;
        }
      } catch (e) {}
      fallback();
    });
    return b;
  }

  // In the app: fetch the newest script now instead of waiting for the daily check.
  // If there is one, the app reloads X with it; otherwise this button reports back.
  function updateButton() {
    if (!NATIVE || typeof NATIVE.checkUpdate !== 'function') return null;
    var b = h('button', { class: 'btn ghost', type: 'button', text: 'Check for updates' });
    b.addEventListener('click', function () {
      if (b.disabled) return;
      b.disabled = true;
      b.textContent = 'Checking…';
      try { NATIVE.checkUpdate(); } catch (e) {}
      setTimeout(function () { b.textContent = 'No newer version (v' + VERSION + ')'; }, 8000);
    });
    return b;
  }

  // Search, Notifications and Chat, opened through X's own (hidden) links.
  function goRow() {
    var row = h('div', { class: 'go' });
    GO_TO.forEach(function (d) {
      var label = d.label, link = document.querySelector('[data-testid="' + d.testid + '"]');
      var unread = link && /(\d+\+?)\s+unread/i.exec(link.getAttribute('aria-label') || '');
      if (unread) label += ' (' + unread[1] + ')';
      row.appendChild(h('button', {
        class: 'btn', type: 'button', text: label,
        onclick: function () {
          show(null);
          var l = document.querySelector('[data-testid="' + d.testid + '"]');
          if (l) l.click();
          else window.location.assign(d.path);
        }
      }));
    });
    return row;
  }

  function buildSettings() {
    var draft = state.pendingLimitMin || state.limitMin;
    var colorDraft = state.colorMin;
    var effect = h('p', { class: 'note', text: '' });
    function upd() {
      effect.textContent = draft > state.limitMin
        ? 'Today stays at ' + state.limitMin + ' min. ' + draft + ' min starts tomorrow.'
        : draft < state.limitMin
          ? 'Drops to ' + draft + ' min right away.'
          : 'Lowering applies right away. Raising applies from tomorrow.';
    }
    upd();

    var opts = h('div', { class: 'opts', role: 'group', 'aria-label': 'Colour time per day' });
    var optBtns = COLOR_CHOICES.map(function (min) {
      var b = h('button', {
        class: 'btn', type: 'button', text: min ? min + ' min' : 'Off',
        onclick: function () { colorDraft = min; paint(); }
      });
      opts.appendChild(b);
      return b;
    });
    function paint() {
      optBtns.forEach(function (b, i) {
        var on = COLOR_CHOICES[i] === colorDraft;
        b.classList.toggle('sel', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    paint();

    var ads = checkRow('xf-hideads', 'Hide ads', state.hideAds);
    var clean = checkRow('xf-clean', 'Hide Spaces, Grok and upsells', state.clean);
    var navBox = checkRow('xf-nav', 'Three buttons at the bottom instead of X\u2019s bar', state.nav);
    var black = checkRow('xf-black', 'True black background', state.blackBg);
    var posts = checkRow('xf-hideposts', 'Hide the whole post when it contains a video', state.hidePosts);

    return [goRow(), h('div', { class: 'cap small', text: 'Daily limit' })]
      .concat(limitSlider(draft, function (v) { draft = v; upd(); }))
      .concat([
        effect,
        h('div', { class: 'cap small', text: 'Colour per day' }),
        opts,
        h('p', { class: 'note', text: BACKDROP_OK
          ? 'Hold a finger on a picture to see that post in colour. Used today: ' +
            Math.floor(state.colorUsedSec / 60) + ' of ' + state.colorMin + ' min.'
          : 'This browser cannot show single posts in colour.' }),
        h('div', { class: 'checks' }, [ads.row, navBox.row, clean.row, black.row, posts.row]),
        h('div', { class: 'cap small', text: 'Last 7 days' })
      ])
      .concat(weekView(lastDays(7, true)))
      .concat([
        h('p', { class: 'note', text: 'Used today: ' + Math.floor(state.usedSec / 60) + ' min' +
          (state.extCount ? ' · extra time taken ' + state.extCount + '×' : '') + ' · v' + VERSION }),
        reportButton(),
        updateButton(),
        h('button', {
          class: 'btn', type: 'button', text: 'Done',
          onclick: function () {
            if (draft > state.limitMin) {
              state.pendingLimitMin = draft;
              state.pendingFrom = tomorrowKey();
            } else {
              state.limitMin = draft;
              state.pendingLimitMin = 0;
              state.pendingFrom = '';
            }
            state.colorMin = colorDraft;
            state.hideAds = !!ads.box.checked;
            state.clean = !!clean.box.checked;
            state.blackBg = !!black.box.checked;
            state.nav = !!navBox.box.checked;
            state.hidePosts = !!posts.box.checked;
            applyFlags();
            ensureBlackTheme();
            save();
            show(null);
            render();
          }
        })
      ]);
  }

  function buildBye() {
    setTimeout(function () {
      if (mode !== 'bye') return;
      if (NATIVE && typeof NATIVE.close === 'function') {
        try { NATIVE.close(); } catch (e0) {}
        show(null);
        return;
      }
      try { window.close(); } catch (e) {}
      try { window.location.replace('about:blank'); } catch (e2) {}
    }, 900);
    return [
      h('div', { class: 'cap', text: 'Closed' }),
      h('p', { class: 'txt', text: 'Good call. ' + Math.ceil(remainingSec() / 60) + ' min saved for later today.' }),
      h('p', { class: 'note', text: 'You can close this tab now.' }),
      h('button', { class: 'btn ghost', type: 'button', text: 'Back to X', onclick: function () { show(null); } })
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Colour: hold a picture to see its post in colour                    */
  /* ------------------------------------------------------------------ */

  var peek = null;                 // { el: the post, or null for the photo viewer }
  var press = null, pressFiredAt = 0, swallowClick = false;

  function isPhotoPath() { return /\/(photo|media)\/\d+/.test(window.location.pathname || ''); }

  function setHole(rect) {
    if (!greyEl) return;
    if (rect === 'all') { greyEl.style.display = 'none'; return; }
    greyEl.style.display = '';
    if (!rect) { greyEl.style.clipPath = ''; greyEl.style.webkitClipPath = ''; return; }
    var l = Math.round(rect.left), t = Math.round(rect.top), r = Math.round(rect.right), b = Math.round(rect.bottom);
    var path = 'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ' +
      l + 'px ' + t + 'px, ' + r + 'px ' + t + 'px, ' + r + 'px ' + b + 'px, ' + l + 'px ' + b + 'px, ' + l + 'px ' + t + 'px)';
    greyEl.style.clipPath = path;
    greyEl.style.webkitClipPath = path;
  }

  function startPeek(el) {
    peek = { el: el };
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) {}
    updatePeek();
    render();
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 32); };
    (function loop() {
      if (!peek) return;
      updatePeek();
      raf(loop);
    })();
  }

  function endPeek() {
    if (!peek) return;
    peek = null;
    setHole(null);
    save();
    if (bar) render();
  }

  // Keeps the colour window on the post as it scrolls; ends when it leaves.
  function updatePeek() {
    if (!peek) return;
    if (isPhotoPath()) { setHole('all'); return; }
    var el = peek.el;
    if (!el || !el.isConnected) { endPeek(); return; }
    var r = el.getBoundingClientRect();
    if (r.height < 1 || r.bottom <= barH || r.top >= window.innerHeight) { endPeek(); return; }
    setHole(r);
  }

  function firePress(target) {
    if (Date.now() - pressFiredAt < 900) return true;
    if (!target || !target.closest || !loaded || mode || !state.limitMin || !greyEl || !layerGrey) return false;
    var onPhoto = isPhotoPath();
    var art = target.closest('article');
    if (art ? !target.closest(PICTURE_SEL) : !onPhoto) return false;
    pressFiredAt = Date.now();
    swallowClick = true;
    if (peek && (peek.el === art || (!art && onPhoto))) { endPeek(); return true; }
    if (!state.colorMin) { note('Colour is off in settings'); return true; }
    if (colorLeftSec() <= 0) { note('No colour time left today'); return true; }
    startPeek(art || null);
    return true;
  }

  function cancelPress() {
    if (press) { clearTimeout(press.timer); press = null; }
  }

  function listenForPress() {
    document.addEventListener('pointerdown', function (e) {
      swallowClick = false;
      cancelPress();
      if (e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.target === host) return;
      var target = e.target;
      press = { x: e.clientX, y: e.clientY, timer: setTimeout(function () { press = null; firePress(target); }, 520) };
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (press && (Math.abs(e.clientX - press.x) > 10 || Math.abs(e.clientY - press.y) > 10)) cancelPress();
    }, true);
    document.addEventListener('pointerup', cancelPress, true);
    document.addEventListener('pointercancel', cancelPress, true);
    // Phones report a long press as a context-menu request; use it as the
    // signal and keep the browser's own menu out of the way.
    document.addEventListener('contextmenu', function (e) {
      if (e.target === host) return;
      cancelPress();
      if (firePress(e.target)) e.preventDefault();
    }, true);
    // Lifting the finger after a long press must not open the post.
    document.addEventListener('click', function (e) {
      if (e.target === host) { swallowClick = false; return; }
      if (swallowClick) {
        swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  /* ------------------------------------------------------------------ */
  /* Main loop                                                           */
  /* ------------------------------------------------------------------ */

  var lastTick = Date.now();
  var wantGate = true, hiddenAt = 0;

  // Sign-in and sign-out screens stay untouched and unmetered.
  function isAuthPath() {
    var p = window.location.pathname || '';
    return /^\/(i\/flow|login|logout|account\/access|i\/oauth2?)(\/|$)/.test(p);
  }

  function tick() {
    var now = Date.now();
    var dt = (now - lastTick) / 1000;
    lastTick = now;

    if (!ensureMounted() || !loaded) return;

    if (rollover() && (mode === 'lock' || mode === 'checkpoint')) show(null);
    applyFlags();

    if (state.clean && /^\/i\/(spaces|broadcasts)(\/|$)/.test(window.location.pathname)) {
      window.location.replace('/home');
      return;
    }
    tryPendingTab();

    var auth = isAuthPath();
    setBarVisible(!auth);
    if (auth) {
      endPeek();
      if (mode) show(null);
      return;
    }

    if (!state.limitMin) {
      wantGate = false; // first run: straight into X once the limit is chosen
      render();
      show('setup');
      return;
    }

    var visible = document.visibilityState === 'visible';
    var step = Math.min(Math.max(dt, 0), 2);
    var locked = state.usedSec >= budgetSec();
    if (wantGate) {
      wantGate = false;
      if (!locked && (!mode || mode === 'settings')) show('gate', Date.now());
    }
    // Only time spent in X itself (or its settings) uses the day's minutes;
    // the opening, check-in, summary and goodbye screens do not.
    if (!locked && visible && (!mode || mode === 'settings')) {
      state.usedSec = Math.min(state.usedSec + step, budgetSec());
      dirty++;
      locked = state.usedSec >= budgetSec();
    }
    if (peek && visible) {
      state.colorUsedSec += step;
      dirty++;
      if (colorLeftSec() <= 0) {
        endPeek();
        note('Colour time is used up for today');
      }
    }

    var cp = Math.floor(state.usedSec / STEP);
    if (locked) {
      if (mode !== 'lock') { save(); show('lock'); }
    } else {
      if (mode === 'lock') show(null);
      if (!mode) {
        if (weekDue()) show('week');
        else if (cp > state.ackCp) show('checkpoint', cp);
      }
    }

    render();
    if (dirty >= 5) save();
  }

  var scanTimer = 0;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = 0;
      try { scanVideos(); } catch (e) {}
      try { scanAds(); } catch (e1) {}
      try { scanSpaces(); } catch (e3) {}
      try { scanTabs(); } catch (e4) {}
      try { scanCarousels(); } catch (e7) {}
      try { fixGap(); } catch (e8) {}
      try { applyFlags(); tryPendingTab(); } catch (e5) {}
      try { if (bar && loaded) renderNav(); } catch (e6) {}
      try { adjustLayout(); } catch (e2) {}
    }, 200);
  }

  function start() {
    flag('data-xf-rootgrey', true);
    ensurePageStyle();
    applyFlags();
    try {
      new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    window.addEventListener('scroll', scheduleScan, { passive: true, capture: true });
    window.addEventListener('resize', scheduleScan, { passive: true });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        lastTick = Date.now();
        if (hiddenAt && Date.now() - hiddenAt >= REOPEN_AFTER) wantGate = true;
        hiddenAt = 0;
        loadState().then(tick, noop);
      } else {
        hiddenAt = Date.now();
        endPeek();
        save();
      }
    });
    window.addEventListener('pagehide', save);
    listenForPress();

    setInterval(tick, 1000);
    setInterval(function () {
      if (overlayTick) overlayTick();
    }, 250);
    setInterval(scheduleScan, 1500);

    loadState().then(tick, function () { loaded = true; tick(); });
  }

  if (document.documentElement) {
    start();
  } else {
    var waitRoot = setInterval(function () {
      if (document.documentElement) { clearInterval(waitRoot); start(); }
    }, 10);
  }
})();
