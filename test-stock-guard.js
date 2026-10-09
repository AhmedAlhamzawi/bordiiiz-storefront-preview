#!/usr/bin/env node
// Proves the two rules in build.js actually fire. `node test-stock-guard.js`
//
// The rule that matters: we must never ship a checkout that can sell stock we
// do not have. A payment link is payable by anyone who has the URL, any number
// of times, so "we checked stock before publishing" is not a control — the cap
// on the link is the control. These cases check the build refuses to render a
// pay button unless that cap matches real stock.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bordiiiz-guard-'));

const SHOP = {
  currency: 'USD',
  human_name: 'A Real Person',
  human_phone: '+1 555 0100',
  delivery_promise: 'In your hands by Fri',
  postal_address: '1 Real Street',
  confirmation_url: './confirmation.html',
};

const GOOD = {
  slug: 'good', title: 'Good Game', sentence: 'A sentence.', players: '2-4',
  minutes: 30, age: 8, price: 19, stock: 5, photo: 'box.jpg',
  payment_link: 'https://pay.example/good', payment_link_max_payments: 5,
};

function run(name, game) {
  const file = path.join(tmp, name + '.json');
  const dist = path.join(tmp, name + '-dist');
  fs.writeFileSync(file, JSON.stringify({
    shop: SHOP,
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
  ['baseline-sellable', { ...GOOD }, true, 'everything filled and cap === stock'],
  ['cap-above-stock', { ...GOOD, stock: 5, payment_link_max_payments: 100 }, false, 'link capped at 100 but only 5 boxes exist'],
  ['cap-below-stock', { ...GOOD, stock: 5, payment_link_max_payments: 2 }, false, 'cap must match stock exactly, not merely be safe'],
  ['no-cap', { ...GOOD, payment_link_max_payments: null }, false, 'an uncapped link can be paid forever'],
  ['zero-stock', { ...GOOD, stock: 0, payment_link_max_payments: 0 }, false, 'nothing to sell'],
  ['negative-stock', { ...GOOD, stock: -3, payment_link_max_payments: -3 }, false, 'nonsense stock must not become a pay button'],
  ['fractional-stock', { ...GOOD, stock: 2.5, payment_link_max_payments: 2.5 }, false, 'half a box is not a box'],
  ['no-payment-link', { ...GOOD, payment_link: null }, false, 'no link, no button'],
  ['no-photo', { ...GOOD, photo: null }, false, 'board asked for a real photo of the box in hands'],
  ['no-sentence', { ...GOOD, sentence: null }, false, 'one sentence per game is the whole product page'],
];

let failed = 0;
for (const [name, game, shouldSell, why] of cases) {
  const html = run(name, { ...game, slug: name });
  const hasPayButton = /class="btn" href="https:\/\/pay\.example/.test(html);
  const saysNotForSale = /Not for sale yet/.test(html);
  const ok = hasPayButton === shouldSell && saysNotForSale === !shouldSell;
  if (!ok) failed++;
  console.log(
    (ok ? '  pass  ' : '  FAIL  ') +
    name.padEnd(20) +
    (hasPayButton ? 'pay button rendered' : 'no pay button').padEnd(22) +
    why
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (cases.length - failed) + ' of ' + cases.length + ' guard cases pass.');
process.exit(failed ? 1 : 0);
