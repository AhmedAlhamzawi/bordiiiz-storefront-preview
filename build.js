#!/usr/bin/env node
// Bordiiiz storefront builder — BOR-6, board cut of 9 Oct 2026.
// 10 game cards and a payment link. No cart. No shipping. Three taps to buy.
//
//   node build.js            build into dist/ and print the readiness table
//   node build.js --strict   same, but exit 1 unless all 10 games can take money
//
// --strict is the gate for going live. If it exits 1, we are not live.
//
// Two rules this file enforces so a human cannot forget them:
//   1. A game with no confirmed stock gets NO pay button. Ever. (Never ship a
//      checkout that can sell stock we do not have.)
//   2. A payment link must be capped at the stock count, because a link with no
//      cap can be paid any number of times and we cannot un-sell a box.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
// CATALOG / DIST let the guard test build throwaway fixtures without touching
// the real catalog. Unset in normal use.
const DIST = process.env.DIST || path.join(ROOT, 'dist');
const catalog = JSON.parse(fs.readFileSync(process.env.CATALOG || path.join(ROOT, 'catalog.json'), 'utf8'));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => Number(n).toFixed(2);

// ---------------------------------------------------------------- readiness

const GAME_FIELDS = ['title', 'sentence', 'players', 'minutes', 'age', 'price', 'stock', 'photo', 'payment_link', 'payment_link_max_payments'];
const SHOP_FIELDS = ['currency', 'human_name', 'human_phone', 'delivery_promise', 'postal_address'];

// A field with no entry in _owners still has to render and still has to count.
// Never let a missing owner label crash the build that reports it.
const ownerOf = (map, f) => (map && map[f]) || 'owner unassigned';

function shopGaps() {
  return SHOP_FIELDS.filter((f) => catalog.shop[f] === null || catalog.shop[f] === undefined || catalog.shop[f] === '')
    .map((f) => ({ field: f, owner: ownerOf(catalog._shop_owners, f) }));
}

function gameGaps(game) {
  const gaps = GAME_FIELDS.filter((f) => game[f] === null || game[f] === undefined || game[f] === '')
    .map((f) => ({ field: f, owner: ownerOf(catalog._owners, f) }));

  // Rule 1: stock must be a real positive integer before a pay button exists.
  if (game.stock !== null && !(Number.isInteger(game.stock) && game.stock > 0)) {
    gaps.push({ field: 'stock', owner: 'stock must be a whole number above 0 — got ' + JSON.stringify(game.stock) });
  }
  // Rule 2: the payment link cap must match stock exactly.
  if (game.payment_link_max_payments !== null && game.stock !== null && game.payment_link_max_payments !== game.stock) {
    gaps.push({
      field: 'payment_link_max_payments',
      owner: `cap is ${game.payment_link_max_payments} but stock is ${game.stock} — an uncapped or over-capped link sells boxes we do not have`,
    });
  }
  return gaps;
}

// ------------------------------------------------------------------- styles
// Inlined on purpose: zero external requests, one round trip. The 2.0s ceiling
// on BOR-7 is measured on a phone on mobile data, not on a laptop.

const CSS = `*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#14110f;--ink2:#5a524c;--line:#e6e0d8;--bg:#fbf8f4;--card:#fff;--accent:#b4442c;--ok:#1d6f42;--warn:#9a5b00;--pad:16px;--r:14px}
html{-webkit-text-size-adjust:100%}
body{font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--ink);background:var(--bg)}
img,svg{display:block;max-width:100%}
a{color:inherit}
.wrap{max-width:720px;margin:0 auto;padding:0 var(--pad)}
.preview{background:#14110f;color:#fbf8f4;font-size:13px;line-height:1.4;padding:10px var(--pad);text-align:center}
.preview b{color:#f0b429}
header{border-bottom:1px solid var(--line);background:var(--card)}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px var(--pad);max-width:720px;margin:0 auto}
.logo{font-size:19px;font-weight:700;letter-spacing:-.4px;text-decoration:none}
.logo span{color:var(--accent)}
.bar .human{font-size:13.5px;color:var(--ink2);text-decoration:none;text-align:right}
.bar .human b{display:block;color:var(--ink)}
.hero{padding:28px 0 18px}
.hero h1{font-size:28px;line-height:1.15;letter-spacing:-.6px;margin-bottom:10px}
.hero p{color:var(--ink2);max-width:40ch}
.steps{display:flex;gap:8px;margin:20px 0 4px;font-size:13px;color:var(--ink2)}
.steps li{list-style:none;flex:1;border-top:3px solid var(--line);padding-top:7px}
.steps li.on{border-top-color:var(--accent);color:var(--ink);font-weight:600}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.09em;color:var(--ink2);margin:30px 0 12px;font-weight:700}
.grid{display:grid;gap:14px;grid-template-columns:1fr}
@media(min-width:560px){.grid{grid-template-columns:1fr 1fr}.hero h1{font-size:34px}}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;text-decoration:none;display:flex;flex-direction:column}
.card .art{aspect-ratio:4/3;background:#f2ece4;width:100%;object-fit:cover}
.card .body{padding:14px;display:flex;flex-direction:column;gap:7px;flex:1}
.card h3{font-size:17px;line-height:1.25;letter-spacing:-.2px}
.evening{font-size:13.5px;color:var(--ink2)}
.row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:auto;padding-top:4px}
.price{font-size:17px;font-weight:700}
.price small{font-weight:400;color:var(--ink2);font-size:12px}
.stock{font-size:12.5px;color:var(--ok);font-weight:600}
.stock.low{color:var(--warn)}
.card.pending{opacity:.72}
.card.pending .stock{color:var(--ink2)}
.crumb{padding:14px 0 2px;font-size:14px}
.crumb a{color:var(--ink2);text-decoration:none}
h1.g{font-size:27px;line-height:1.18;letter-spacing:-.5px;margin:14px 0 8px}
.lede{font-size:17px;line-height:1.45;color:var(--ink);max-width:42ch;margin-bottom:18px}
.facts{display:flex;gap:10px;margin:0 0 20px}
.fact{flex:1;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center}
.fact b{display:block;font-size:16px}
.fact span{font-size:12px;color:var(--ink2)}
.buy{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px;margin-bottom:8px}
.ptop{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px}
.btn{display:block;background:var(--accent);color:#fff;text-align:center;font-size:17px;font-weight:700;padding:15px;border-radius:11px;text-decoration:none;border:0;width:100%}
.btn:active{background:#9c3722}
.note{font-size:12.5px;color:var(--ink2);margin-top:10px}
.hand{font-size:14px;color:var(--ink2);margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.hand b{color:var(--ink)}
.blocked{background:#fff6ea;border:1px solid #f0d9b5;border-radius:11px;padding:14px;font-size:14px}
.blocked b{display:block;margin-bottom:6px;font-size:15px}
.blocked ul{margin:8px 0 0 18px;color:var(--ink2);font-size:13px}
.trust{list-style:none;margin:0 0 8px}
.trust li{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);font-size:14px}
.trust li b{flex:0 0 84px}
.trust li span{color:var(--ink2)}
footer{margin:36px 0 0;border-top:1px solid var(--line);background:var(--card)}
.foot{max-width:720px;margin:0 auto;padding:20px var(--pad) 32px;font-size:13.5px;color:var(--ink2);display:flex;flex-direction:column;gap:10px}
.pay{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.pay b{font-size:11px;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--line);border-radius:5px;padding:4px 7px;color:var(--ink2);font-weight:700}
.foot a{color:var(--ink);text-decoration:underline}`;

// ---------------------------------------------------------------- fragments

const S = catalog.shop;
const cur = S.currency || 'CUR';
const live = (v, fallback) => (v === null || v === undefined || v === '' ? fallback : v);

function head(title, desc) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<style>${CSS}</style>
</head>
<body>

<p class="preview"><b>PREVIEW BUILD</b> &mdash; generated by <code>build.js</code> from <code>catalog.json</code>. No money moves here yet.</p>

<header>
  <div class="bar">
    <a class="logo" href="./index.html">Bordii<span>i</span>iz</a>
    ${S.human_name && S.human_phone
      ? `<a class="human" href="tel:${esc(String(S.human_phone).replace(/\s/g, ''))}"><b>${esc(S.human_name)}</b>${esc(S.human_phone)}</a>`
      : `<span class="human"><b>A human answers</b>name and number pending</span>`}
  </div>
</header>
`;
}

function foot() {
  return `
<footer>
  <div class="foot">
    <div class="pay"><b>Cards</b><b>Apple Pay</b></div>
    <p>${S.postal_address ? esc(S.postal_address) : 'Bordiiiz &mdash; Boddies Board Games. A real postal address goes here before we take a single order.'}</p>
    <p><a href="./returns.html">Returns in 14 days</a> &middot; ${S.human_phone ? `<a href="tel:${esc(String(S.human_phone).replace(/\s/g, ''))}">Talk to a human</a>` : 'Talk to a human'}</p>
  </div>
</footer>

</body>
</html>
`;
}

// Placeholder art for a game with no real photo yet. The board asked for real
// photos of the box in someone's hands; this square is a visible absence, not a
// stand-in that could be mistaken for one.
function art(game, ratio) {
  if (game.photo) return `<img class="art" src="${esc(game.photo)}" alt="${esc(game.title)} box, held in someone's hands" width="400" height="${ratio === 'square' ? 400 : 300}" loading="lazy">`;
  return `<svg class="art" viewBox="0 0 400 ${ratio === 'square' ? 400 : 300}" role="img" aria-label="Photo pending"><rect width="400" height="${ratio === 'square' ? 400 : 300}" fill="#f2ece4"/><text x="200" y="${ratio === 'square' ? 205 : 155}" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#a39a92">photo pending</text></svg>`;
}

// ------------------------------------------------------------------- pages

function indexPage(report) {
  const cards = report.map(({ game, gaps }) => {
    const ready = gaps.length === 0;
    const title = live(game.title, 'Game ' + game.slug.replace(/^game-/, ''));
    const line = game.sentence
      ? esc(game.sentence)
      : [game.players && game.players + ' players', game.minutes && game.minutes + ' min'].filter(Boolean).join(' &middot; ') || 'Details pending';
    return `    <a class="card${ready ? '' : ' pending'}" href="./g/${esc(game.slug)}.html">
      ${art(game, 'wide')}
      <div class="body">
        <h3>${esc(title)}</h3>
        <p class="evening">${line}</p>
        <div class="row">
          <span class="price">${game.price !== null ? money(game.price) + ' <small>' + esc(cur) + '</small>' : '<small>price pending</small>'}</span>
          <span class="stock${ready && game.stock <= 3 ? ' low' : ''}">${ready ? (game.stock <= 3 ? 'Only ' + game.stock + ' left' : 'In stock') : 'Not for sale yet'}</span>
        </div>
      </div>
    </a>`;
  }).join('\n\n');

  const readyCount = report.filter((r) => r.gaps.length === 0).length;

  return head('Bordiiiz — a reason to sit together', 'Ten games picked for the evening, not the shelf.') +
`
<main class="wrap">

  <section class="hero">
    <h1>We don't sell cardboard.<br>We sell the evening.</h1>
    <p>Ten games. Each one picked for a particular kind of evening with a particular kind of people.</p>
    <ol class="steps">
      <li class="on">1. Pick</li>
      <li>2. Pay</li>
      <li>3. Address</li>
    </ol>
  </section>

  <h2>Good for tonight &middot; ${readyCount} of ${report.length} ready</h2>

  <div class="grid">

${cards}

  </div>

</main>
` + foot();
}

function gamePage(game, gaps) {
  const ready = gaps.length === 0;
  const title = live(game.title, 'Game ' + game.slug.replace(/^game-/, ''));

  const buy = ready
    ? `  <div class="buy">
    <div class="ptop">
      <span class="price">${money(game.price)} <small>${esc(cur)}</small></span>
      <span class="stock${game.stock <= 3 ? ' low' : ''}">${game.stock <= 3 ? 'Only ' + game.stock + ' left' : 'In stock &middot; ' + game.stock + ' boxes'}</span>
    </div>
    <a class="btn" href="${esc(game.payment_link)}">Pay ${money(game.price)} ${esc(cur)}</a>
    <p class="note">One tap to the payment page. Card or Apple Pay, and your address on the same screen. That is the whole checkout.</p>
    <p class="hand">${S.human_name ? `<b>${esc(S.human_name)}</b> hands this one over personally` : 'Handed over personally'}${S.delivery_promise ? ` &mdash; ${esc(S.delivery_promise)}` : ''}.${S.human_phone ? ` Ring <b>${esc(S.human_phone)}</b> if anything is wrong.` : ''}</p>
  </div>`
    : `  <div class="blocked">
    <b>Not for sale yet</b>
    This page is built but it cannot take money. Missing:
    <ul>
${gaps.map((g) => `      <li><code>${esc(g.field)}</code> &mdash; ${esc(g.owner)}</li>`).join('\n')}
    </ul>
  </div>`;

  return head(title + ' — Bordiiiz', game.sentence || 'Game page, Bordiiiz.') +
`
<main class="wrap">

  <p class="crumb"><a href="../index.html">&larr; All ten games</a></p>

  ${art(game, 'square')}

  <h1 class="g">${esc(title)}</h1>
  <p class="lede">${game.sentence ? esc(game.sentence) : '<em>One sentence pending from Supply: why this game, tonight, with these people.</em>'}</p>

  <div class="facts">
    <div class="fact"><b>${esc(live(game.players, '—'))}</b><span>players</span></div>
    <div class="fact"><b>${game.minutes !== null ? esc(game.minutes) + ' min' : '—'}</b><span>an evening</span></div>
    <div class="fact"><b>${game.age !== null ? esc(game.age) + '+' : '—'}</b><span>age</span></div>
  </div>

${buy}

  <h2>Before you buy</h2>
  <ul class="trust">
    <li><b>Returns</b><span>14 days, box opened or not. <a href="../returns.html">How to send it back</a> &mdash; no email needed.</span></li>
    <li><b>Stock</b><span>The number above is real boxes in our room. We never sell a box we do not have.</span></li>
    <li><b>Delivery</b><span>${S.delivery_promise ? esc(S.delivery_promise) : 'An honest date goes here. Delivery is in our own hands for the first ten orders.'}</span></li>
    <li><b>A human</b><span>${S.human_name && S.human_phone ? esc(S.human_name) + ' answers on ' + esc(S.human_phone) + ', same day.' : 'A person answers, same day. Name and number pending.'}</span></li>
  </ul>

</main>
` + foot();
}

// -------------------------------------------------------------------- build

const report = catalog.games.map((game) => ({ game, gaps: gameGaps(game) }));
const sGaps = shopGaps();

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'g'), { recursive: true });

fs.writeFileSync(path.join(DIST, 'index.html'), indexPage(report));
for (const { game, gaps } of report) {
  fs.writeFileSync(path.join(DIST, 'g', game.slug + '.html'), gamePage(game, gaps));
}
// Pages the game pages link to. Copied, not regenerated — they are hand-written.
for (const f of ['confirmation.html', 'returns.html']) {
  if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
}

// ------------------------------------------------------------------- report

const readyCount = report.filter((r) => r.gaps.length === 0).length;
const pad = (s, n) => String(s).padEnd(n);

console.log('\nBordiiiz storefront build — ' + report.length + ' game pages written to dist/\n');
console.log(pad('GAME', 14) + pad('CAN TAKE MONEY', 16) + 'MISSING');
console.log('-'.repeat(72));
for (const { game, gaps } of report) {
  console.log(pad(game.slug, 14) + pad(gaps.length === 0 ? 'yes' : 'NO', 16) + (gaps.length === 0 ? '—' : gaps.map((g) => g.field).join(', ')));
}
console.log('-'.repeat(72));
console.log('\nGames that can take money: ' + readyCount + ' of ' + report.length);

if (sGaps.length) {
  console.log('\nShop-level fields still missing (every page shows a gap until these land):');
  for (const g of sGaps) console.log('  ' + pad(g.field, 20) + g.owner);
}

// Who we are waiting on, counted once instead of per game.
const byOwner = new Map();
for (const { gaps } of report) for (const g of gaps) {
  const who = g.owner.split('—')[0].trim();
  byOwner.set(who, (byOwner.get(who) || 0) + 1);
}
for (const g of sGaps) {
  const who = g.owner.split('—')[0].trim();
  byOwner.set(who, (byOwner.get(who) || 0) + 1);
}
if (byOwner.size) {
  console.log('\nBlocking cells by owner:');
  for (const [who, n] of [...byOwner].sort((a, b) => b[1] - a[1])) console.log('  ' + pad(n, 5) + who);
}

console.log('');
if (process.argv.includes('--strict')) {
  if (readyCount !== report.length || sGaps.length) {
    console.error('STRICT: not live. ' + (report.length - readyCount) + ' game(s) cannot take money, ' + sGaps.length + ' shop field(s) missing.');
    process.exit(1);
  }
  console.log('STRICT: all ' + report.length + ' games can take money and every shop field is filled.');
}
