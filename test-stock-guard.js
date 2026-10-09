#!/usr/bin/env node
// Proves the three rules in build.js actually fire. `node test-stock-guard.js`
//
// The rule that matters: we must never ship a checkout that can sell stock we
// do not have. A payment link is payable by anyone who has the URL, any number
// of times, so "we checked stock before publishing" is not a control — the cap
// on the link is the control. These cases check the build refuses to render a
// pay button unless that cap matches the number of boxes we can actually
// produce, under either promise: a sealed box we hold, or one we will buy.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bordiiiz-guard-'));

const SHOP = {
  city_ar: 'بغداد',
  currency: 'IQD',
  currency_ar: 'د.ع',
  human_name: 'A Real Person',
  human_name_ar: 'إنسان حقيقي',
  human_phone: '+964 770 000 0000',
  delivery_promise_ar: 'بيدك قبل الخميس',
  postal_address_ar: 'شارع حقيقي، بغداد',
  confirmation_url: './confirmation.html',
};

const DELIVERY_LINES = {
  approved: true,
  tonight: 'نسخة مغلّفة موجودة عندنا الآن.',
  days_2_3: 'نشتريها لك ونوصّلها خلال يومين إلى ثلاثة.',
};

// A game that can take money: we hold 5 sealed boxes, the link is capped at 5.
const GOOD = {
  sku: 'BZ-000', slug: 'good', title_en: 'Good Game', title_ar: 'لعبة زينة',
  sentence_en: 'A sentence.', sentence_ar: 'سطر عربي حقيقي.',
  players: '2-4', minutes: '30', teach: 'دقيقتين', age: 8,
  language_ar: 'ماكو كتابة على القطع', box_class: 'S',
  delivery_line: 'tonight',
  price_iqd: 25000, stock: 5, backorder_cap: null, photo: 'box.jpg',
  payment_link: 'https://pay.example/good', payment_link_max_payments: 5,
};

// The demo-only half of Supply's buy: no sealed box, but we will buy one.
const BACKORDER = {
  ...GOOD, delivery_line: 'days_2_3',
  stock: 0, backorder_cap: 3, payment_link_max_payments: 3,
};

function run(name, game, opts = {}) {
  const file = path.join(tmp, name + '.json');
  const dist = path.join(tmp, name + '-dist');
  fs.writeFileSync(file, JSON.stringify({
    shop: SHOP,
    delivery_lines: opts.delivery_lines || DELIVERY_LINES,
    copy: opts.copy || { approved: true },
    _owners: {}, _shop_owners: {},
    games: [game],
  }));
  execFileSync(process.execPath, [path.join(ROOT, 'build.js')], {
    env: { ...process.env, CATALOG: file, DIST: dist },
    stdio: 'pipe',
  });
  return fs.readFileSync(path.join(dist, 'g', game.slug + '.html'), 'utf8');
}

const cases = [
  // --- the sealed-box promise
  ['baseline-sellable', { ...GOOD }, true, 'we hold 5 boxes and the cap is 5'],
  ['cap-above-stock', { ...GOOD, payment_link_max_payments: 100 }, false, 'link capped at 100 but only 5 boxes exist'],
  ['cap-below-stock', { ...GOOD, payment_link_max_payments: 2 }, false, 'cap must match the count exactly, not merely be safe'],
  ['no-cap', { ...GOOD, payment_link_max_payments: null }, false, 'an uncapped link can be paid forever'],
  ['zero-stock', { ...GOOD, stock: 0, payment_link_max_payments: 0 }, false, 'nothing to sell and nothing promised'],
  ['negative-stock', { ...GOOD, stock: -3, payment_link_max_payments: -3 }, false, 'nonsense stock must not become a pay button'],
  ['fractional-stock', { ...GOOD, stock: 2.5, payment_link_max_payments: 2.5 }, false, 'half a box is not a box'],
  ['uncounted-stock', { ...GOOD, stock: null }, false, 'null is "nobody counted", not "we have some"'],

  // --- the we-will-buy-it promise, which is the other half of Supply's buy
  ['backorder-sellable', { ...BACKORDER }, true, 'no sealed box, capped at the 3 we will buy, and the card says so'],
  ['backorder-uncapped', { ...BACKORDER, payment_link_max_payments: null }, false, 'a backorder link with no cap is the worst of both'],
  ['backorder-cap-mismatch', { ...BACKORDER, payment_link_max_payments: 9 }, false, 'cap 9 against a commitment of 3'],
  ['backorder-fractional', { ...BACKORDER, backorder_cap: 1.5, payment_link_max_payments: 1.5 }, false, 'we cannot buy half a box either'],
  ['backorder-negative', { ...BACKORDER, backorder_cap: -2, payment_link_max_payments: -2 }, false, 'nonsense cap must not become a button'],
  ['backorder-without-zero-stock', { ...BACKORDER, stock: null }, false, 'a cap only counts once someone has confirmed stock is 0'],

  // --- the promise on the card must match the count behind it
  ['lies-tonight', { ...BACKORDER, delivery_line: 'tonight' }, false, 'says we have one here while stock is 0'],
  ['lies-days', { ...GOOD, delivery_line: 'days_2_3' }, false, 'says we must buy it while 5 sit on the shelf'],
  ['no-delivery-line', { ...GOOD, delivery_line: null }, false, 'no promise at all is still a dead end'],
  ['bogus-delivery-line', { ...GOOD, delivery_line: 'next_year' }, false, 'two lines, never a third'],

  // --- the rest of the card
  ['no-payment-link', { ...GOOD, payment_link: null }, false, 'no link, no button'],
  ['no-photo', { ...GOOD, photo: null }, false, 'board asked for a real photo of the box in hands'],
  ['no-arabic-sentence', { ...GOOD, sentence_ar: null }, false, 'the Arabic line is what a Baghdad customer reads'],
  ['no-price', { ...GOOD, price_iqd: null }, false, 'a price we have not confirmed cannot go on the page'],
  ['zero-price', { ...GOOD, price_iqd: 0 }, false, 'free is not a price'],
];

let failed = 0;
for (const [name, game, shouldSell, why] of cases) {
  const html = run(name, { ...game, slug: name });
  const hasPayButton = /class="btn" href="https:\/\/pay\.example/.test(html);
  const saysNotForSale = html.includes('ما تنباع بعد');
  const ok = hasPayButton === shouldSell && saysNotForSale === !shouldSell;
  if (!ok) failed++;
  console.log(
    (ok ? '  pass  ' : '  FAIL  ') +
    name.padEnd(28) +
    (hasPayButton ? 'pay button rendered' : 'no pay button').padEnd(22) +
    why
  );
}

// --- gates that apply to every game at once, not one cell at a time
const gated = [
  ['copy-not-approved', { copy: { approved: false } }, 'Arabic copy exists but Supply has not confirmed it'],
  ['delivery-not-approved', { delivery_lines: { ...DELIVERY_LINES, approved: false } }, 'the delivery promise is not approved by the Founder'],
];
for (const [name, opts, why] of gated) {
  const html = run(name, { ...GOOD, slug: name }, opts);
  const hasPayButton = /class="btn" href="https:\/\/pay\.example/.test(html);
  const ok = hasPayButton === false;
  if (!ok) failed++;
  console.log((ok ? '  pass  ' : '  FAIL  ') + name.padEnd(28) + 'no pay button'.padEnd(22) + why);
}

// --- rule 3: a card never makes a vague stock claim. It gives a number, or it
// says out loud that we do not have one yet.
const sellableHtml = run('rule3-tonight', { ...GOOD, slug: 'rule3-tonight' });
const backorderHtml = run('rule3-backorder', { ...BACKORDER, slug: 'rule3-backorder' });
const rule3 = [
  ['says the real count', /٥ نسخ مغلّفة عندنا/.test(sellableHtml)],
  ['never claims "in stock"', !/in stock/i.test(sellableHtml) && !/in stock/i.test(backorderHtml)],
  ['backorder card admits we do not have one', backorderHtml.includes('ماكو نسخة مغلّفة عندنا الآن')],
  ['page is Arabic and right-to-left', /<html lang="ar" dir="rtl">/.test(sellableHtml)],
];
for (const [label, pass] of rule3) {
  if (!pass) failed++;
  console.log((pass ? '  pass  ' : '  FAIL  ') + label);
}

// The report must not crash when a catalog has no _owners map at all.
assert.doesNotThrow(() => run('no-owners', { ...GOOD, slug: 'no-owners', photo: null }));

fs.rmSync(tmp, { recursive: true, force: true });
const total = cases.length + gated.length + rule3.length;
console.log('\n' + (total - failed) + ' of ' + total + ' guard cases pass.');
process.exit(failed ? 1 : 0);
