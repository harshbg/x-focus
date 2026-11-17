// ==UserScript==
// @name         X Focus
// @namespace    x-focus
// @version      2.1.0
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

  var VERSION = '2.1.0';

  // Present only inside the X Focus Android app.
  var NATIVE = null;
  try { if (window.XFocusNative && typeof window.XFocusNative.getValue === 'function') NATIVE = window.XFocusNative; } catch (e) {}

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  var STEP = 300;                 // seconds between check-ins (5 minutes)
  var BLOCK = 600;                // seconds per block in the progress bar (10 minutes)
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
    'body{box-sizing:border-box!important;padding-top:var(--xf-h,0px)!important}',
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
    // Clean mode: no Grok, no Premium upsells.
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
      if (v && v.tagName === 'VIDEO') quiet(v);
    }, true);
  });
  try {
    var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    if (proto && typeof proto.play === 'function') {
      var origPlay = proto.play;
      proto.play = function () {
        if (this && this.tagName === 'VIDEO') {
          return Promise.reject(new DOMException('Video is turned off by X Focus', 'NotAllowedError'));
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

  function adjustLayout() {
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
    ovIn = h('div', { class: 'in' });
    ov = h('div', { class: 'ov', hidden: '' }, [ovIn]);

    ui.appendChild(uiStyle);
    if (BACKDROP_OK) {
      greyEl = h('div', { class: 'grey' });
      ui.appendChild(greyEl);
    }
    ui.appendChild(bar);
    ui.appendChild(ov);
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
    var clean = checkRow('xf-clean', 'Hide Grok and upsells', state.clean);
    var black = checkRow('xf-black', 'True black background', state.blackBg);
    var posts = checkRow('xf-hideposts', 'Hide the whole post when it contains a video', state.hidePosts);

    return [h('div', { class: 'cap', text: 'Daily limit' })]
      .concat(limitSlider(draft, function (v) { draft = v; upd(); }))
      .concat([
        effect,
        h('div', { class: 'cap small', text: 'Colour per day' }),
        opts,
        h('p', { class: 'note', text: BACKDROP_OK
          ? 'Hold a finger on a picture to see that post in colour. Used today: ' +
            Math.floor(state.colorUsedSec / 60) + ' of ' + state.colorMin + ' min.'
          : 'This browser cannot show single posts in colour.' }),
        h('div', { class: 'checks' }, [ads.row, clean.row, black.row, posts.row]),
        h('p', { class: 'note', text: 'Used today: ' + Math.floor(state.usedSec / 60) + ' min' +
          (state.extCount ? ' · extra time taken ' + state.extCount + '×' : '') + ' · v' + VERSION }),
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
      if (!swallowClick) return;
      swallowClick = false;
      if (e.target === host) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  /* ------------------------------------------------------------------ */
  /* Main loop                                                           */
  /* ------------------------------------------------------------------ */

  var lastTick = Date.now();

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

    var auth = isAuthPath();
    setBarVisible(!auth);
    if (auth) {
      endPeek();
      if (mode) show(null);
      return;
    }

    if (!state.limitMin) {
      render();
      show('setup');
      return;
    }

    var visible = document.visibilityState === 'visible';
    var step = Math.min(Math.max(dt, 0), 2);
    var locked = state.usedSec >= budgetSec();
    // The check-in and goodbye screens do not eat into the day's minutes.
    if (!locked && visible && mode !== 'bye' && mode !== 'checkpoint') {
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
      if (cp > state.ackCp && !mode) show('checkpoint', cp);
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
        loadState().then(tick, noop);
      } else {
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
