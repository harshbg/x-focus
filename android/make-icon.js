// Renders the launcher icon PNGs. Run: node make-icon.js
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const mark = (c, r, w) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c * 2} ${c * 2}" width="${c * 2}" height="${c * 2}">
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#5a5a5a" stroke-width="${w}"/>
  <path d="M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - r} ${c}" fill="none" stroke="#fff" stroke-width="${w}"/>
  <path d="M ${c} ${c} L ${c} ${c - r * 0.55}" stroke="#fff" stroke-width="${w * 0.8}" stroke-linecap="butt"/>
</svg>`;
(async () => {
  const b = await chromium.launch();
  async function shot(file, size, html, bg) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent(`<body style="margin:0;background:${bg}">${html}</body>`);
    await p.screenshot({ path: file, omitBackground: bg === 'transparent' });
    await p.close();
  }
  await shot('res/mipmap-xxxhdpi/ic_fg.png', 432, mark(216, 82, 30), 'transparent');
  await shot('res/mipmap-xxxhdpi/ic_launcher.png', 192, mark(96, 52, 19), '#000');
  await b.close();
})();
