#!/usr/bin/env node
// Bordiiiz storefront builder — BOR-6, board cut of 9 Oct 2026.
// 10 game cards and a payment link. No cart. No shipping. Three taps to buy.
//
//   node build.js            build into dist/ and print the readiness table
//   node build.js --strict   same, but exit 1 unless all 10 games can take money
//
// --strict is the gate for going live. If it exits 1, we are not live.
//
// The customer reads Arabic. Baghdad, Iraqi dinar, phone first (Founder, BOR-29).
// So every page is lang=ar dir=rtl and every string a customer sees is Arabic.
// Latin text survives only as a game's brand name, which is what a Baghdad shelf
// looks like anyway.
//
// Three rules this file enforces so a human cannot forget them:
//   1. A game with no confirmed sellable count gets NO pay button. Ever.
//      (Never ship a checkout that can sell stock we do not have.)
//   2. A payment link must be capped at the sellable count, because a link with
//      no cap can be paid any number of times and we cannot un-sell a box.
//   3. A card never says "in stock". It says the number, or it says we will buy
//      it for you in 2-3 days. A vague claim is how we end up lying.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
// CATALOG / DIST let the guard test build throwaway fixtures without touching
// the real catalog. Unset in normal use.
const DIST = process.env.DIST || path.join(ROOT, 'dist');
const catalog = JSON.parse(fs.readFileSync(process.env.CATALOG || path.join(ROOT, 'catalog.json'), 'utf8'));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Arabic-Indic digits. The whole page is Arabic; a Western numeral in the middle
// of an Arabic sentence reads like a different language dropped in.
const ad = (s) => String(s).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);
// IQD has no subunit. 25000 is "٢٥٬٠٠٠", never "25000.00".
const money = (n) => ad(Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬'));

const missing = (v) => v === null || v === undefined || v === '';
const posInt = (v) => Number.isInteger(v) && v > 0;

// ------------------------------------------------------------ sellable count
// Supply's buy is 15 boxes for 10 titles: five titles get a sealed second copy,
// five are demo-only (BOR-4, `the-ten`). A demo copy has been opened and played,
// so it is NOT stock. That left five cards that could never earn a buy button
// under rule 1, which would have quietly killed half the catalog.
//
// So there are two honest ways to be sellable, and exactly one promise per card:
//
//   stock > 0           -> we hand over a sealed box we already have. "tonight".
//   stock 0, cap > 0    -> we do not have one. We buy it at retail and hand it
//                          over in 2-3 days, and the card says so. "days_2_3".
//
// Both are a positive integer we can be held to. Neither lets us take more money
// than boxes we can produce. What is still forbidden is the thing it looks like:
// an unbounded "we can get anything" button.
function sellable(game) {
  if (posInt(game.stock)) return { count: game.stock, mode: 'tonight', from: 'stock' };
  if (game.stock === 0 && posInt(game.backorder_cap)) return { count: game.backorder_cap, mode: 'days_2_3', from: 'backorder_cap' };
  return { count: 0, mode: null, from: null };
}

// ---------------------------------------------------------------- readiness

const SHOP_FIELDS = ['city_ar', 'currency', 'currency_ar', 'human_name_ar', 'human_phone', 'delivery_promise_ar', 'postal_address_ar'];

// A field with no entry in _owners still has to render and still has to count.
// Never let a missing owner label crash the build that reports it.
const ownerOf = (map, f) => (map && map[f]) || 'owner unassigned';

function shopGaps() {
  return SHOP_FIELDS.filter((f) => missing(catalog.shop[f]))
    .map((f) => ({ field: f, owner: ownerOf(catalog._shop_owners, f) }));
}

function gameGaps(game) {
  const gaps = [];
  const sell = sellable(game);
  const add = (field, owner) => gaps.push({ field, owner });

  // Copy. sentence_en is Supply's English line and it is already in hand; the
  // blocking cell is the Arabic one, because that is what a customer reads.
  if (missing(game.sentence_ar)) add('sentence_ar', ownerOf(catalog._owners, 'sentence_ar'));
  else if (!catalog.copy || catalog.copy.approved !== true) add('sentence_ar', 'written but not confirmed — copy.approved is false (Head of Supply & Catalog)');

  if (missing(game.photo)) add('photo', ownerOf(catalog._owners, 'photo'));
  if (!(typeof game.price_iqd === 'number' && game.price_iqd > 0)) {
    add('price_iqd', missing(game.price_iqd) ? ownerOf(catalog._owners, 'price_iqd') : 'price must be a positive number of dinars — got ' + JSON.stringify(game.price_iqd));
  }

  // Rule 1: a positive integer we can be held to, or no button.
  if (sell.count === 0) {
    add('stock', missing(game.stock) && missing(game.backorder_cap)
      ? ownerOf(catalog._owners, 'stock')
      : `no sellable count — stock ${JSON.stringify(game.stock)}, backorder_cap ${JSON.stringify(game.backorder_cap)}. Need a whole number above 0 in one of them`);
  }

  // The delivery promise and the sellable count must tell the same story. A card
  // that says "we have one here" while stock is 0 is the dead end we never ship.
  if (missing(game.delivery_line)) add('delivery_line', 'Head of Supply & Catalog — tonight | days_2_3');
  else if (!['tonight', 'days_2_3'].includes(game.delivery_line)) add('delivery_line', 'must be tonight | days_2_3 — got ' + JSON.stringify(game.delivery_line));
  else if (sell.mode && game.delivery_line !== sell.mode) {
    add('delivery_line', `says "${game.delivery_line}" but the count comes from ${sell.from} — that is "${sell.mode}". One promise per card, and it has to be the true one`);
  }
  if (!catalog.delivery_lines || catalog.delivery_lines.approved !== true) {
    add('delivery_line', 'Founder & CEO — delivery_lines.approved is false, and a delivery date is a promise');
  }

  // Rule 2: the payment link cap must match the sellable count exactly.
  if (missing(game.payment_link)) add('payment_link', ownerOf(catalog._owners, 'payment_link'));
  if (missing(game.payment_link_max_payments)) add('payment_link_max_payments', ownerOf(catalog._owners, 'payment_link_max_payments'));
  else if (sell.count > 0 && game.payment_link_max_payments !== sell.count) {
    add('payment_link_max_payments', `cap is ${game.payment_link_max_payments} but we can produce ${sell.count} — an uncapped or over-capped link sells boxes we do not have`);
  }
  return gaps;
}

// ------------------------------------------------------------------- styles
// Inlined on purpose: zero external requests, one round trip. The 2.0s ceiling
// on BOR-7 is measured on a phone on mobile data, not on a laptop — and the real
// test is a Baghdad cafe's wifi at a game night (Growth, BOR-12).
// Logical properties (inline-start/end) so one stylesheet is correct in RTL.

const CSS = `*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#14110f;--ink2:#5a524c;--line:#e6e0d8;--bg:#fbf8f4;--card:#fff;--accent:#b4442c;--ok:#1d6f42;--warn:#9a5b00;--pad:16px;--r:14px}
html{-webkit-text-size-adjust:100%}
body{font:16px/1.65 -apple-system,BlinkMacSystemFont,"SF Arabic","Segoe UI","Noto Naskh Arabic","Droid Arabic Naskh",Tahoma,Arial,sans-serif;color:var(--ink);background:var(--bg)}
img,svg{display:block;max-width:100%}
a{color:inherit}
.wrap{max-width:720px;margin:0 auto;padding:0 var(--pad)}
.preview{background:#14110f;color:#fbf8f4;font-size:13px;line-height:1.5;padding:10px var(--pad);text-align:center}
.preview b{color:#f0b429}
header{border-bottom:1px solid var(--line);background:var(--card)}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px var(--pad);max-width:720px;margin:0 auto}
.logo{font-size:19px;font-weight:700;letter-spacing:-.4px;text-decoration:none;direction:ltr}
.logo span{color:var(--accent)}
.bar .human{font-size:13.5px;color:var(--ink2);text-decoration:none;text-align:end}
.bar .human b{display:block;color:var(--ink)}
.bar .human bdi{direction:ltr;unicode-bidi:isolate}
.hero{padding:28px 0 18px}
.hero h1{font-size:28px;line-height:1.3;margin-bottom:10px}
.hero p{color:var(--ink2);max-width:42ch}
.steps{display:flex;gap:8px;margin:20px 0 4px;font-size:13px;color:var(--ink2)}
.steps li{list-style:none;flex:1;border-top:3px solid var(--line);padding-top:7px}
.steps li.on{border-top-color:var(--accent);color:var(--ink);font-weight:600}
h2{font-size:14px;letter-spacing:.02em;color:var(--ink2);margin:30px 0 12px;font-weight:700}
.grid{display:grid;gap:14px;grid-template-columns:1fr}
@media(min-width:560px){.grid{grid-template-columns:1fr 1fr}.hero h1{font-size:33px}}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;text-decoration:none;display:flex;flex-direction:column}
.card .art{aspect-ratio:4/3;background:#f2ece4;width:100%;object-fit:cover}
.card .body{padding:14px;display:flex;flex-direction:column;gap:7px;flex:1}
.card h3{font-size:18px;line-height:1.35}
.card h3 bdi{direction:ltr;unicode-bidi:isolate}
.evening{font-size:14px;color:var(--ink2)}
.row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:auto;padding-top:4px}
.price{font-size:17px;font-weight:700}
.price small{font-weight:400;color:var(--ink2);font-size:12px}
.have{font-size:12.5px;color:var(--ok);font-weight:600;text-align:end}
.have.soon{color:var(--warn)}
.card.pending{opacity:.72}
.card.pending .have{color:var(--ink2)}
.crumb{padding:14px 0 2px;font-size:14px}
.crumb a{color:var(--ink2);text-decoration:none}
h1.g{font-size:27px;line-height:1.3;margin:14px 0 8px}
h1.g bdi{direction:ltr;unicode-bidi:isolate}
.lede{font-size:18px;line-height:1.6;color:var(--ink);max-width:44ch;margin-bottom:18px}
.facts{display:flex;gap:10px;margin:0 0 20px}
.fact{flex:1;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center}
.fact b{display:block;font-size:16px}
.fact span{font-size:12px;color:var(--ink2)}
.buy{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px;margin-bottom:8px}
.ptop{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px}
.btn{display:block;background:var(--accent);color:#fff;text-align:center;font-size:18px;font-weight:700;padding:15px;border-radius:11px;text-decoration:none;border:0;width:100%}
.btn:active{background:#9c3722}
.note{font-size:13px;color:var(--ink2);margin-top:10px}
.hand{font-size:14px;color:var(--ink2);margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.hand b{color:var(--ink)}
.hand bdi{direction:ltr;unicode-bidi:isolate}
.blocked{background:#fff6ea;border:1px solid #f0d9b5;border-radius:11px;padding:14px;font-size:14px}
.blocked b{display:block;margin-bottom:6px;font-size:15px}
.blocked ul{margin:8px 18px 0 0;color:var(--ink2);font-size:13px;direction:ltr;text-align:left}
.trust{list-style:none;margin:0 0 8px}
.trust li{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);font-size:14px}
.trust li b{flex:0 0 92px}
.trust li span{color:var(--ink2)}
footer{margin:36px 0 0;border-top:1px solid var(--line);background:var(--card)}
.foot{max-width:720px;margin:0 auto;padding:20px var(--pad) 32px;font-size:13.5px;color:var(--ink2);display:flex;flex-direction:column;gap:10px}
.pay{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.pay b{font-size:11px;letter-spacing:.04em;border:1px solid var(--line);border-radius:5px;padding:4px 7px;color:var(--ink2);font-weight:700}
.foot a{color:var(--ink);text-decoration:underline}
.foot bdi{direction:ltr;unicode-bidi:isolate}`;

// ---------------------------------------------------------------- fragments

const S = catalog.shop;
const DL = catalog.delivery_lines || {};
const cur = S.currency_ar || 'د.ع';
const telHref = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');

// A game's display name: the Arabic name when Supply gave one, else the brand
// name, isolated so bidi does not scramble it inside an Arabic line.
const nameOf = (g) => (g.title_ar ? esc(g.title_ar) : `<bdi>${esc(g.title_en || g.slug)}</bdi>`);
const plainName = (g) => g.title_ar || g.title_en || g.slug;

function head(title, desc) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<style>${CSS}</style>
</head>
<body>

<p class="preview"><b>نسخة تجريبية</b> &mdash; مبنية من <code>catalog.json</code>. ماكو فلوس تتحرك هنا بعد.</p>

<header>
  <div class="bar">
    <a class="logo" href="./index.html">Bordii<span>i</span>iz</a>
    ${S.human_name_ar && S.human_phone
      ? `<a class="human" href="${esc(telHref(S.human_phone))}"><b>${esc(S.human_name_ar)}</b><bdi>${esc(S.human_phone)}</bdi></a>`
      : `<span class="human"><b>يجاوبك إنسان</b>الاسم والرقم بعدهم ما وصلوا</span>`}
  </div>
</header>
`;
}

// No payment badges. The Founder's ruling on BOR-45 is explicit: we take no
// cards, and no payment method is NAMED on the live page until 1,000 IQD has
// actually moved through it. A row of card logos over a wallet transfer is the
// exact lie that makes a hesitating customer leave and not come back.
function foot() {
  return `
<footer>
  <div class="foot">
    <p>${S.postal_address_ar ? esc(S.postal_address_ar) : 'بورديز &mdash; عنوان حقيقي يجي هنا قبل ما نستلم أي طلب.'}</p>
    <p><a href="./returns.html">الإرجاع خلال ١٤ يوم</a> &middot; ${S.human_phone ? `<a href="${esc(telHref(S.human_phone))}">تكلم مع إنسان</a>` : 'تكلم مع إنسان'}</p>
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
  const h = ratio === 'square' ? 400 : 300;
  if (game.photo) return `<img class="art" src="${esc(game.photo)}" alt="علبة ${esc(plainName(game))} بيد واحد من الناس" width="400" height="${h}" loading="lazy">`;
  return `<svg class="art" viewBox="0 0 400 ${h}" role="img" aria-label="الصورة بعدها ما وصلت"><rect width="400" height="${h}" fill="#f2ece4"/><text x="200" y="${ratio === 'square' ? 205 : 155}" text-anchor="middle" font-family="Tahoma,sans-serif" font-size="15" fill="#a39a92">الصورة بعدها ما وصلت</text></svg>`;
}

// What the customer is told about having it. Never the words "in stock":
// either a number of sealed boxes, or we say out loud that we will go buy it.
function haveLine(game, sell, short) {
  if (sell.mode === 'tonight') {
    return sell.count <= 2
      ? `باقي ${ad(sell.count)} ${sell.count === 1 ? 'نسخة' : 'نسخ'}`
      : `${ad(sell.count)} نسخ مغلّفة عندنا`;
  }
  if (sell.mode === 'days_2_3') return short ? 'نشتريها لك' : 'نشتريها لك ونوصّلها خلال يومين إلى ٣';
  return 'ما تنباع بعد';
}

// ------------------------------------------------------------------- pages

function indexPage(report) {
  const cards = report.map(({ game, gaps, sell }) => {
    const ready = gaps.length === 0;
    const line = game.sentence_ar
      ? esc(game.sentence_ar)
      : `<em>السطر العربي بعده ما وصل من Supply</em>`;
    return `    <a class="card${ready ? '' : ' pending'}" href="./g/${esc(game.slug)}.html">
      ${art(game, 'wide')}
      <div class="body">
        <h3>${nameOf(game)}</h3>
        <p class="evening">${line}</p>
        <div class="row">
          <span class="price">${game.price_iqd ? money(game.price_iqd) + ' <small>' + esc(cur) + '</small>' : '<small>السعر بعده ما تثبّت</small>'}</span>
          <span class="have${ready && sell.mode === 'days_2_3' ? ' soon' : ''}">${ready ? haveLine(game, sell, true) : 'ما تنباع بعد'}</span>
        </div>
      </div>
    </a>`;
  }).join('\n\n');

  const readyCount = report.filter((r) => r.gaps.length === 0).length;

  return head('بورديز — سبب تگعدون سوا', 'عشر ألعاب مختارة للسهرة، مو للرف.') +
`
<main class="wrap">

  <section class="hero">
    <h1>إحنا ما نبيع كارتون.<br>إحنا نبيع السهرة.</h1>
    <p>عشر ألعاب. كل وحدة مختارة لنوع سهرة معيّن، ولنوع ناس معيّن.</p>
    <ol class="steps">
      <li class="on">١. تختار</li>
      <li>٢. تدفع</li>
      <li>٣. العنوان</li>
    </ol>
  </section>

  <h2>زينة لهاي الليلة &middot; ${ad(readyCount)} من ${ad(report.length)} جاهزة</h2>

  <div class="grid">

${cards}

  </div>

</main>
` + foot();
}

function gamePage(game, gaps, sell) {
  const ready = gaps.length === 0;
  const deliveryText = DL.approved === true ? DL[game.delivery_line] : null;

  const buy = ready
    ? `  <div class="buy">
    <div class="ptop">
      <span class="price">${money(game.price_iqd)} <small>${esc(cur)}</small></span>
      <span class="have${sell.mode === 'days_2_3' ? ' soon' : ''}">${haveLine(game, sell, false)}</span>
    </div>
    <a class="btn" href="${esc(game.payment_link)}">ادفع ${money(game.price_iqd)} ${esc(cur)}</a>
    <p class="note">نقرة وحدة لصفحة الدفع. البطاقة والعنوان بنفس الشاشة. هذا كل الشراء.</p>
    <p class="hand">${deliveryText ? esc(deliveryText) + ' ' : ''}${S.delivery_promise_ar ? esc(S.delivery_promise_ar) + ' ' : ''}${S.human_name_ar ? `<b>${esc(S.human_name_ar)}</b> مسؤول عن طلبك شخصياً.` : 'واحد مننا مسؤول عن طلبك شخصياً.'}${S.human_phone ? ` إذا اكو شي غلط، اتصل بـ <b><bdi>${esc(S.human_phone)}</bdi></b>.` : ''}</p>
  </div>`
    : `  <div class="blocked">
    <b>ما تنباع بعد</b>
    هاي الصفحة مبنية بس ما تگدر تستلم فلوس. الناقص:
    <ul>
${gaps.map((g) => `      <li><code>${esc(g.field)}</code> &mdash; ${esc(g.owner)}</li>`).join('\n')}
    </ul>
  </div>`;

  return head(plainName(game) + ' — بورديز', game.sentence_ar || 'صفحة لعبة، بورديز.') +
`
<main class="wrap">

  <p class="crumb"><a href="../index.html">&rarr; كل العشر ألعاب</a></p>

  ${art(game, 'square')}

  <h1 class="g">${nameOf(game)}</h1>
  <p class="lede">${game.sentence_ar ? esc(game.sentence_ar) : '<em>السطر العربي بعده ما وصل من Supply: ليش هاي اللعبة، هاي الليلة، مع هذولا الناس.</em>'}</p>

  <div class="facts">
    <div class="fact"><b>${game.players ? ad(game.players) : '—'}</b><span>لاعبين</span></div>
    <div class="fact"><b>${game.minutes ? ad(game.minutes) + ' دقيقة' : '—'}</b><span>السهرة</span></div>
    <div class="fact"><b>${game.teach ? esc(ad(game.teach)) : '—'}</b><span>تتعلمها بـ</span></div>
    <div class="fact"><b>${game.age !== null && game.age !== undefined ? ad(game.age) + '+' : '—'}</b><span>العمر</span></div>
  </div>

${buy}

  <h2>قبل ما تشتري</h2>
  <ul class="trust">
    <li><b>الإرجاع</b><span>١٤ يوم، فتحت العلبة أو لا. <a href="../returns.html">شلون ترجّعها</a> &mdash; بدون إيميل.</span></li>
    <li><b>النسخ</b><span>${sell.mode === 'days_2_3'
      ? 'ماكو نسخة مغلّفة عندنا الآن، وهذا مكتوب فوق. نشتريها لك ونوصّلها باليد. ما نبيع علبة ما عندنا بدون ما نگولها.'
      : 'الرقم اللي فوق هو نسخ مغلّفة موجودة بغرفتنا. ما نبيع علبة ما عندنا.'}</span></li>
    <li><b>اللغة</b><span>${game.language_ar ? esc(game.language_ar) : 'بعدها ما وصلت من Supply.'}</span></li>
    <li><b>التوصيل</b><span>${S.delivery_promise_ar
      ? esc(S.delivery_promise_ar) + (S.ship_cutoff_local ? ` اطلب قبل ${ad(S.ship_cutoff_local)} ونبدي بطلبك نفس اليوم.` : '')
      : 'تاريخ صادق يجي هنا من Ops.'}</span></li>
    <li><b>إنسان</b><span>${S.human_name_ar && S.human_phone ? esc(S.human_name_ar) + ' يجاوب على <bdi>' + esc(S.human_phone) + '</bdi>، نفس اليوم.' : 'واحد مننا يجاوب نفس اليوم. الاسم والرقم بعدهم ما وصلوا.'}</span></li>
  </ul>

</main>
` + foot();
}

// -------------------------------------------------------------------- build

const report = catalog.games.map((game) => ({ game, gaps: gameGaps(game), sell: sellable(game) }));
const sGaps = shopGaps();

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'g'), { recursive: true });

fs.writeFileSync(path.join(DIST, 'index.html'), indexPage(report));
for (const { game, gaps, sell } of report) {
  fs.writeFileSync(path.join(DIST, 'g', game.slug + '.html'), gamePage(game, gaps, sell));
}
// Pages the game pages link to. Copied, not regenerated — they are hand-written.
for (const f of ['confirmation.html', 'returns.html']) {
  if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
}

// ------------------------------------------------------------------- report

const readyCount = report.filter((r) => r.gaps.length === 0).length;
const pad = (s, n) => String(s).padEnd(n);

console.log('\nBordiiiz storefront build — ' + report.length + ' Arabic RTL game pages written to dist/\n');
console.log(pad('GAME', 24) + pad('CAN TAKE MONEY', 16) + pad('SELLS', 18) + 'MISSING');
console.log('-'.repeat(96));
for (const { game, gaps, sell } of report) {
  const sells = sell.count > 0 ? `${sell.count} (${sell.mode})` : '—';
  console.log(pad(game.slug, 24) + pad(gaps.length === 0 ? 'yes' : 'NO', 16) + pad(sells, 18) +
    (gaps.length === 0 ? '—' : [...new Set(gaps.map((g) => g.field))].join(', ')));
}
console.log('-'.repeat(96));
console.log('\nGames that can take money: ' + readyCount + ' of ' + report.length);

if (sGaps.length) {
  console.log('\nShop-level fields still missing (every page shows a gap until these land):');
  for (const g of sGaps) console.log('  ' + pad(g.field, 22) + g.owner);
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
