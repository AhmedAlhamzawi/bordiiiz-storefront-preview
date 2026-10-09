# Bordiiiz — storefront

**Nothing here takes money yet.** Run `node check-sellable.js` for the live
answer to "can a stranger buy a game today?" — it is currently no, with five
named blockers and an owner against each.

## The board cut, 9 Oct 2026

Scope for Wed 14 Oct is **10 game cards and a payment link**. Three taps: pick,
pay, address. No cart. No shipping build — delivery is the Founder's hands for
the first 10 orders.

## Two order paths currently live in this repo

They have not been reconciled, and the choice is a Founder decision (BOR-6):

| | `catalog.json` + `build.js` | `ar/config.json` + `ar/make.py` |
|---|---|---|
| Market | English, currency undecided | Arabic, Baghdad, IQD |
| Games | 10 slots, 3 named | 6, real copy and prices |
| Order path | payment link | WhatsApp (`wa.me`) |
| Takes a card | yes | **no** |
| Can produce `payment_state = paid` | yes | **no** |
| Stock guarded at point of sale | yes, enforced | **no stock field exists** |

The second row is the one that matters: KR3 counts paid orders. A WhatsApp
button produces a written order, not a paid one.

## Files

- `catalog.json` — one source of truth for the English cards. Fill a cell, run
  the build. Nobody hand-edits a game page.
- `build.js` — emits `dist/index.html` and `dist/g/<slug>.html`. `--strict`
  exits 1 unless every game can take money. Inlines its own CSS: zero external
  requests, one round trip, ~2.8 KB gzipped per page against the 2.0s ceiling
  on BOR-7.
- `check-sellable.js` — the 14 Oct go/no-go gate. Reads every catalog in the
  repo and answers whether a *paid* order is possible and whether stock is
  guarded. `--strict` exits 1 while the gate is shut.
- `confirmation.html` — the post-payment page carrying the "how did you hear
  about us?" question (BOR-24). Free text survives, so `NIGHT-01` style codes
  reach the order log as typed.
- `returns.html` — hand-written, copied into `dist/` by the build.
- `index.html`, `product-codenames.html` — **superseded** by `build.js`. They
  still show a cart, which the board cut. Do not publish them.

## Two rules the build enforces so a human cannot forget them

1. A game with no confirmed positive stock gets no pay button.
2. A payment link must be capped at the stock count. An uncapped link can be
   paid any number of times and we cannot un-sell a box.

`node test-stock-guard.js` proves both against 10 cases, including an uncapped
link, a cap above stock, zero stock and a fractional box.

## Tests

```
node test-stock-guard.js              # 10 cases, the sellability guard
node test-attribution.js confirmation.html   # 21 cases, the channel question
node check-sellable.js --strict       # the go/no-go gate
```
