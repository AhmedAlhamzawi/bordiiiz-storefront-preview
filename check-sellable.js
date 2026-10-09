#!/usr/bin/env node
// The 14 Oct go/no-go gate. BOR-6.
//
//   node check-sellable.js            print the gate
//   node check-sellable.js --strict   exit 1 unless we can actually go live
//
// This file does not build anything. It answers two questions that BOR-6 owns
// and nobody else can answer for us:
//
//   1. Can a customer produce a PAID order? KR3 counts payment_state = paid.
//      A button that opens a chat produces a WRITTEN order, not a paid one.
//      A storefront that cannot produce a paid row is, for KR3, a zero.
//
//   2. Is stock guarded at the point of sale? We never ship a checkout that can
//      sell stock we do not have. "We looked at the shelf before publishing" is
//      not a guard — the guard has to live on the order path itself.
//
// It reads every catalog in the repo rather than one, because the repo currently
// has two order paths in it and the gate has to cover whichever one goes live.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const findings = [];
const add = (sev, where, what, owner) => findings.push({ sev, where, what, owner });

const read = (p) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return null; }
};
const missing = (v) => v === null || v === undefined || v === '';

// ---------------------------------------------- path A: English payment link

const catalog = read('catalog.json');
if (catalog) {
  const games = catalog.games || [];
  const sellable = games.filter((g) =>
    !missing(g.payment_link) &&
    Number.isInteger(g.stock) && g.stock > 0 &&
    g.payment_link_max_payments === g.stock
  );
  console.log(`\nPATH A — catalog.json, payment link, ${games.length} games`);
  console.log(`  can produce a PAID order: ${sellable.length} of ${games.length}`);
  console.log(`  captures money on the page: yes, a payment link takes a card`);
  console.log(`  stock guarded at point of sale: yes, build.js refuses a button unless cap === stock`);
  if (sellable.length === 0) {
    add('BLOCK', 'catalog.json', `0 of ${games.length} games can take money — no payment links exist`,
      'Founder & CEO (payment account is a money decision) + Head of Supply & Catalog (price, stock, photo)');
  }
} else {
  add('BLOCK', 'catalog.json', 'catalog missing or unparseable', 'Head of Product & Tech');
}

// --------------------------------------------- path B: Arabic WhatsApp order

const ar = read('ar/config.json');
if (ar) {
  const games = ar.games || [];
  const noStock = games.filter((g) => missing(g.stock));
  const waOrder = String(ar.whatsapp || '').trim() !== '';

  console.log(`\nPATH B — ar/config.json, WhatsApp order, ${games.length} games`);
  console.log(`  can produce a PAID order: 0 of ${games.length}`);
  console.log(`  captures money on the page: NO — wa.me opens a chat, no card is taken`);
  console.log(`  stock guarded at point of sale: NO — ${noStock.length} of ${games.length} games have no stock field at all`);
  console.log(`  order buttons currently live: ${waOrder ? 'yes' : 'no, pre-launch (whatsapp number empty)'}`);

  // The finding that matters. This is not a style note.
  add('BLOCK', 'ar/config.json',
    `a wa.me order path captures no money, so every one of its orders lands as payment_state=written and never as paid — KR3 counts paid only`,
    'Founder & CEO — decide: payment link, or WhatsApp plus a named way to collect money');

  if (noStock.length) {
    add('BLOCK', 'ar/config.json',
      `${noStock.length} of ${games.length} games carry no stock field, so the page can promise a box we do not have (${noStock.map((g) => g.id).join(', ')})`,
      'Head of Supply & Catalog — real boxes in the room per SKU; Head of Product & Tech to wire the guard once the field exists');
  }
  if (ar.prices_approved === false) {
    add('BLOCK', 'ar/config.json', 'prices_approved is false — the price list is a recommendation, not approved',
      'Founder & CEO — approve the price list');
  }
  if (ar.public === false) {
    add('NOTE', 'ar/config.json', 'public is false — pre-launch banner on, noindex on, buttons disabled. Correct for today.',
      'Head of Product & Tech — flip only after the Founder approves name, address, number, prices');
  }
  if (missing(ar.delivery_iqd)) {
    add('NOTE', 'ar/config.json', 'delivery fee is null — told to the customer in chat instead of shown on the page',
      'Ops & Fulfilment Lead');
  }
}

// ------------------------------------- the COD cap switch (BOR-30, Ops owns it)
//
// Ops publishes COD_CAP_TODAY every morning. We never compute it. The only thing
// this gate checks is that the page obeys it in the safe direction: a cap that is
// 0, missing, stale or not an integer must leave cash on delivery ABSENT from the
// page. Every COD order makes us pay the wholesaler before the customer pays us,
// so a bug that opens COD spends money we do not hold. That is the one failure
// that is arithmetic rather than judgement, which is why it lives here and not in
// anyone's head.

{
  const raw = ar ? ar.cod_cap_today : undefined;
  const cap = Number.isInteger(raw) ? raw : 0; // default closed
  const open = cap > 0;
  const built = (() => {
    try { return fs.readFileSync(path.join(ROOT, 'ar/index.html'), 'utf8'); } catch { return ''; }
  })();
  const offersCod = /عند الاستلام/.test(built); // "on receipt" = cash on delivery

  console.log(`\nCOD CAP — BOR-30`);
  console.log(`  COD_CAP_TODAY: ${Number.isInteger(raw) ? raw : `${JSON.stringify(raw)} -> read as 0 (default closed)`}`);
  console.log(`  cash on delivery on the page: ${offersCod ? 'offered' : 'absent'}`);
  console.log(`  verdict: ${offersCod === open ? 'page obeys the cap' : 'MISMATCH'}`);

  if (!open && offersCod) {
    add('BLOCK', 'ar/index.html',
      `COD_CAP_TODAY is ${cap} but the page still offers cash on delivery — every such order spends wholesaler money we do not hold`,
      'Head of Product & Tech — rebuild with python3 ar/make.py; the cap is Ops’ number, never edit the page');
  }
  if (open && !Number.isInteger(ar && ar.cod_cap_today)) {
    add('BLOCK', 'ar/config.json', 'cod_cap_today is not an integer — unreadable caps are treated as closed',
      'Ops & Fulfilment Lead — publish the integer');
  }
}

// ------------------------------------------------------- shop-level truth

if (catalog && catalog.shop) {
  const s = catalog.shop;
  const gaps = ['currency', 'human_name', 'human_phone', 'delivery_promise', 'postal_address'].filter((f) => missing(s[f]));
  if (gaps.length) {
    add('BLOCK', 'catalog.json/shop',
      `${gaps.length} of 5 trust fields empty (${gaps.join(', ')}) — payment logos without a real address and a real human are a lie`,
      'Founder & CEO');
  }
}

// ------------------------------------------------------------------ report

const blocks = findings.filter((f) => f.sev === 'BLOCK');
console.log('\n' + '='.repeat(74));
console.log(blocks.length === 0 ? 'GATE: OPEN — a stranger can buy and the order lands as paid.' : `GATE: SHUT — ${blocks.length} blocker(s) between us and a paid order.`);
console.log('='.repeat(74));

for (const f of findings) {
  console.log(`\n[${f.sev}] ${f.where}`);
  console.log(`  ${f.what}`);
  console.log(`  owner: ${f.owner}`);
}

console.log('\nPaid orders possible today: 0. Target for 14 Oct: a stranger buys unaided.\n');

if (process.argv.includes('--strict') && blocks.length) process.exit(1);
