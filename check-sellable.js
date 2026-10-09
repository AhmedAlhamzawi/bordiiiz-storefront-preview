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
  const mp = catalog.money_path || {};
  // A box we can actually produce: a sealed one we hold, or one we committed to
  // buy. Either way a whole number above zero, and the link capped at it.
  const count = (g) => (Number.isInteger(g.stock) && g.stock > 0 ? g.stock
    : g.stock === 0 && Number.isInteger(g.backorder_cap) && g.backorder_cap > 0 ? g.backorder_cap : 0);
  const sellable = games.filter((g) => !missing(g.payment_link) && count(g) > 0 && g.payment_link_max_payments === count(g));

  console.log(`\nPATH A — catalog.json, payment link, ${games.length} games`);
  console.log(`  can produce a PAID order: ${sellable.length} of ${games.length}`);
  console.log(`  captures money on the page: ${mp.card_acquiring === false ? 'NO — card acquiring is CLOSED, not pending (BOR-29 ruling)' : 'yes, a payment link takes a card'}`);
  console.log(`  stock guarded at point of sale: yes, build.js refuses a button unless the cap equals the sellable count`);

  if (mp.card_acquiring === false) {
    // This is the finding that moved. It is no longer "the Founder has not sent
    // a payment link yet" — it is "there will be no payment link in October".
    add('BLOCK', 'catalog.json',
      'payment_link is null on every title BY RULING, not by delay: no Iraqi gateway onboards an unregistered company inside 5 days (BOR-29). A pay-button-plus-link storefront therefore cannot go live in October at all',
      'Head of Product & Tech — build the wallet money screen from BOR-29 `checkout-copy-ar` instead of waiting on a link that is not coming');
  } else if (sellable.length === 0) {
    add('BLOCK', 'catalog.json', `0 of ${games.length} games can take money — no payment links exist`,
      'Founder & CEO (payment account is a money decision) + Head of Supply & Catalog (price, stock, photo)');
  }

  const noCount = games.filter((g) => count(g) === 0);
  if (noCount.length) {
    add('BLOCK', 'catalog.json',
      `${noCount.length} of ${games.length} titles have no sellable count — no sealed stock and no buy commitment (${noCount.map((g) => g.slug).join(', ')})`,
      'Head of Supply & Catalog — BOR-46. A whole number above 0 in stock, or in backorder_cap with stock 0');
  }
} else {
  add('BLOCK', 'catalog.json', 'catalog missing or unparseable', 'Head of Product & Tech');
}

// ------------------------------------------- the money path the board ruled on

const mp = (catalog && catalog.money_path) || null;
if (mp) {
  const proven = !missing(mp.proven_1000_iqd_at);
  console.log(`\nMONEY PATH — ${mp.method || 'unnamed'}${mp.method_backup ? ' (backup: ' + mp.method_backup + ')' : ''}`);
  console.log(`  can a wallet prepay become payment_state=paid: ${mp.paid_requires_founder_confirmation ? 'yes, after the Founder confirms the transfer' : 'unknown'}`);
  console.log(`  1,000 IQD has actually moved through it: ${proven ? 'yes, ' + mp.proven_1000_iqd_at : 'NO'}`);
  console.log(`  cash on delivery: ${mp.cod ? 'on' : 'off, and absent from the page entirely'}`);

  if (!proven) {
    add('BLOCK', 'catalog.json/money_path',
      'no payment method may be NAMED on the live page until 1,000 IQD has actually moved through it (BOR-29 hard gate). Until then the page ships WhatsApp-only and 14 Oct produces written orders, not paid ones',
      'Founder & CEO — move 1,000 IQD through the wallet and record the timestamp in money_path.proven_1000_iqd_at by Mon 13 Oct 21:00');
  }
  if (mp.paid_requires_founder_confirmation) {
    add('NOTE', 'catalog.json/money_path',
      'a written row moves to paid only on the Founder confirming the money. Correct: I do not hold cash and I do not reconcile it. Attribution does not wait for it — a written row still counts for KR5',
      'Founder & CEO confirms money; Head of Product & Tech owns the flag');
  }
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
  console.log(`  can still reach payment_state=paid: yes, by wallet prepay plus the Founder confirming (BOR-45 ruling)`);
  console.log(`  stock guarded at point of sale: NO — ${noStock.length} of ${games.length} games have no stock field at all`);
  console.log(`  order buttons currently live: ${waOrder ? 'yes' : 'no, pre-launch (whatsapp number empty)'}`);

  // I had this one wrong and the Founder's ruling corrected it. A wa.me order is
  // NOT condemned to payment_state=written: the customer prepays by wallet, the
  // Founder confirms the transfer, and the row becomes paid with a real paid_at.
  // What this path cannot do is pay itself, which is a different problem — it
  // means every paid row waits on one human, so the gate is now the proof that
  // money can move at all, tracked on money_path above.
  add('NOTE', 'ar/config.json',
    'a wa.me order captures no money on the page, but it is not stuck at written: wallet prepay plus a Founder confirmation is a paid row. The cost is that every paid row waits on one person',
    'Founder & CEO confirms each transfer; Head of Product & Tech owns the written -> paid flag');

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
  // The Arabic field names are the live ones — a Baghdad customer reads Arabic,
  // so an English-only value is not a filled trust field.
  const TRUST = ['city_ar', 'currency_ar', 'human_name_ar', 'human_phone', 'delivery_promise_ar', 'postal_address_ar'];
  const gaps = TRUST.filter((f) => missing(s[f]));
  if (gaps.length) {
    add('BLOCK', 'catalog.json/shop',
      `${gaps.length} of ${TRUST.length} trust fields empty (${gaps.join(', ')}) — a customer who hesitates does not come back, and a page with no reachable human is why they hesitate`,
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
