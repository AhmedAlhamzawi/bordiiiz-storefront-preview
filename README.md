# Bordiiiz — storefront

**Nothing here takes money yet.** Run `node check-sellable.js` for the live
answer to "can a stranger buy a game today?" — it is currently no, with named
blockers and an owner against each.

The customer is in Baghdad, pays in Iraqi dinars and reads Arabic on a phone
(Founder, BOR-29). So every generated page is `lang="ar" dir="rtl"` and every
string a customer sees is Arabic. Latin text survives only as a game's brand
name, which is what a Baghdad shelf looks like anyway.

## The board cut, 9 Oct 2026

Scope for Wed 14 Oct is **10 game cards and a payment link**. Three taps: pick,
pay, address. No cart. No shipping build — delivery is hand-delivered by a paid
driver for the first 10 orders (Ops, BOR-35).

**The "payment link" half of that cut is closed by ruling, not by delay.** No
Iraqi gateway onboards an unregistered company inside five days (BOR-29), so
`payment_link` stays null on every title through October. The 14 Oct money path
is WhatsApp for the conversation and a wallet transfer for the money, which the
Founder confirms before any row becomes `paid`. That still produces a *paid*
order — see `money_path` in `catalog.json`. The one thing 14 Oct cannot produce
is an order that pays itself.

## Files

- `catalog.json` — one source of truth. The ten titles, their one-line copy and
  their evening facts are Supply's own table (BOR-4 `the-ten`), copied verbatim.
  Fill a cell, run the build. Nobody hand-edits a game page.
- `build.js` — emits `dist/index.html` and `dist/g/<slug>.html`, Arabic RTL.
  `--strict` exits 1 unless every game can take money. Inlines its own CSS:
  zero external requests, one round trip, ~2.9 KB gzipped for the shop page and
  ~3.3 KB for a game page, against the 2.0s ceiling on BOR-7.
- `check-sellable.js` — the 14 Oct go/no-go gate. Reads every catalog in the
  repo plus the money path, and answers whether a *paid* order is possible and
  whether stock is guarded. `--strict` exits 1 while the gate is shut.
- `confirmation.html` — the post-payment page carrying "شنو خلاك تعرف علينا؟"
  (BOR-24/BOR-9). Seven options, single choice, optional, one tap. We store the
  **option id**, never the Arabic string, so Customer Love can rewrite every
  line tomorrow without moving a number Growth reads.
- `returns.html` — hand-written, copied into `dist/` by the build.
- `index.html`, `product-codenames.html` — **superseded** by `build.js`. They
  still show a cart, which the board cut. Do not publish them.
- `ar/` — the earlier Arabic WhatsApp page (BOR-5). Still the live order path;
  it has no stock field, which `check-sellable.js` reports as a blocker.

## Three rules the build enforces so a human cannot forget them

1. A game with no confirmed **sellable count** gets no pay button. There are
   two honest ways to have one, because Supply's buy is 15 boxes for 10 titles:
   a sealed box we hold (`stock`), or a box we commit to buying and
   hand-delivering (`backorder_cap`, read only when `stock` is 0). Either way a
   whole number above zero. Without this, the five demo-only titles could never
   have earned a buy button at all.
2. A payment link must be capped at that count. An uncapped link can be paid
   any number of times and we cannot un-sell a box.
3. **A card never says "in stock."** It gives the real number of sealed boxes,
   or it says out loud that we do not have one and will go buy it. The delivery
   promise on a card and the count behind it must tell the same story — a card
   claiming a box we do not hold fails the build.

Delivery *timing* is deliberately not in `delivery_lines`: those two lines state
a stock fact only. Ops owns the clock (`shop.delivery_promise_ar`, BOR-13) and
it renders beside them. One promise, one owner.

## Tests

```
node test-stock-guard.js                     # 29 cases, the sellability guard
node test-attribution.js confirmation.html   # 16 checks, the channel question
node check-sellable.js --strict              # the go/no-go gate
```
