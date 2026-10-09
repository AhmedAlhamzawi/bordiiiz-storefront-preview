// Runs the real <script> from confirmation.html against a minimal DOM shim.
//
// The field's owner (Customer Love Lead) revised this twice on 9 Oct:
//   1. the two follow-ups — "which night were you at?" and "who should we
//      thank?" — are CUT. One question, one tap, no branching.
//   2. the Arabic wording is the version that ships, not the English one.
// These checks hold the page to both, and to the one thing that must not drift:
// we store the option id, never the Arabic string, so the wording can change
// tomorrow without moving a number Growth reads.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const HTML = fs.readFileSync(process.argv[2], 'utf8');
const SRC = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

const IDS = ['attribution-form', 'state', 'oid'];

function makeEl(tag) {
  return {
    tagName: tag, id: '', name: '', type: '', value: '', className: '',
    hidden: false, disabled: false, checked: false, children: [], _text: '',
    _listeners: {},
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    dispatch(t, ev) { (this._listeners[t] || []).forEach(fn => fn(ev)); },
  };
}

function run({ live = false, fetchOk = true } = {}) {
  const ids = {};
  for (const id of IDS) {
    ids[id] = makeEl('div'); ids[id].id = id;
    // take the initial hidden state from the real markup, not from the shim
    const tag = HTML.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>'));
    assert.ok(tag, 'confirmation.html must contain an element with id="' + id + '"');
    ids[id].hidden = /\shidden[\s/>=]/.test(tag[0]);
  }
  ids.oid.textContent = 'BOR-10042';

  const store = {};
  const logged = [];
  const fetches = [];

  const sandbox = {
    console: { log: (...a) => logged.push(a) },
    document: {
      getElementById: id => ids[id],
      createElement: makeEl,
      createTextNode: t => ({ textContent: t, children: [] }),
    },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
    fetch: (url, opts) => {
      fetches.push({ url, body: JSON.parse(opts.body) });
      return fetchOk ? Promise.resolve({ ok: true }) : Promise.resolve({ ok: false });
    },
    Date, JSON, Promise,
  };
  sandbox.window = sandbox;
  if (live) sandbox.BORDIIIZ_LIVE = true;

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  const pick = value => {
    const t = makeEl('input'); t.name = 'channel'; t.value = value;
    ids['attribution-form'].dispatch('change', { target: t });
  };

  return { ids, store, logged, fetches, pick };
}

// What a customer can actually read: drop script/style bodies and HTML comments,
// then every tag, so attribute values and source comments are not counted.
const visibleText = html => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]*>/g, ' ');

const SLUGS = ['friend', 'game_night', 'instagram', 'tiktok', 'search', 'facebook', 'other'];

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('Attribution capture — confirmation.html\n');

t('the page a Baghdad customer gets is Arabic and right-to-left', () => {
  assert.ok(/<html lang="ar" dir="rtl">/.test(HTML), 'lang=ar dir=rtl');
});

t('the seven options are in the order Customer Love asked for', () => {
  const block = HTML.match(/<div class="opts">([\s\S]*?)<\/div>/)[1];
  const values = [...block.matchAll(/name="channel" value="([a-z_]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(values, SLUGS);
});

t('the Arabic wording is theirs, verbatim', () => {
  const block = HTML.match(/<div class="opts">([\s\S]*?)<\/div>/)[1];
  const labels = [...block.matchAll(/<span>([^<]+)<\/span>/g)].map(m => m[1]);
  assert.deepStrictEqual(labels, [
    'صديق كَلّي عنكم', 'كنت بليلة ألعاب', 'انستغرام', 'تيك توك',
    'جوجل أو بحث', 'فيسبوك', 'من مكان ثاني',
  ]);
  assert.ok(HTML.includes('شنو خلاك تعرف علينا؟'), 'their question');
  assert.ok(HTML.includes('اختياري — يساعدنا نعرف وين نكون.'), 'their optional hint');
});

t('"a friend told me" is still first, because KR5 is made of that number', () => {
  const block = HTML.match(/<div class="opts">([\s\S]*?)<\/div>/)[1];
  const values = [...block.matchAll(/name="channel" value="([a-z_]+)"/g)].map(m => m[1]);
  assert.strictEqual(values[0], 'friend');
  assert.strictEqual(values[1], 'game_night', 'the game night is second and never merged into the first');
});

t('the superseded English wording is gone from the page', () => {
  const text = visibleText(HTML);
  for (const gone of ['A friend told me', 'I was at a game night', 'I saw it at a game night', 'Somewhere else', 'How did you hear about us']) {
    assert.ok(!text.includes(gone), '"' + gone + '" must not survive on an Arabic page');
  }
});

t('both follow-ups really are cut, not just hidden', () => {
  assert.ok(!/name="night"/.test(HTML), 'no night picker');
  assert.ok(!/id="referred-by"/.test(HTML), 'no "who should we thank?" input');
  assert.ok(!/followup/.test(HTML), 'no leftover follow-up markup to pay for');
  assert.ok(!/type="submit"/.test(HTML), 'nothing to submit: one tap is the whole interaction');
});

t('no NIGHT-xx code is ever shown to a customer', () => {
  assert.ok(!/NIGHT-/.test(visibleText(HTML)), 'a code we invented must never render on screen');
});

t('the question sits after payment, never inside the checkout', () => {
  const paid = HTML.indexOf('تم الدفع');
  const question = HTML.indexOf('id="attribution"');
  assert.ok(paid > -1 && question > paid, 'the question comes after the paid confirmation');
  assert.ok(!/\brequired\b/.test(HTML), 'nothing on this page is required');
});

t('nothing is pre-selected and nothing is saved on load', () => {
  const r = run();
  assert.strictEqual(r.logged.length, 0, 'no save before a tap');
  assert.strictEqual(r.ids.state.hidden, true, 'no message before a tap');
  const preChecked = [...HTML.matchAll(/<input\b[^>]*>/g)].filter(m => /\schecked[\s/>=]/.test(m[0]));
  assert.deepStrictEqual(preChecked, [], 'no input carries a checked attribute');
});

t('one tap saves the channel and says thank you in Arabic', () => {
  const r = run();
  r.pick('instagram');
  assert.strictEqual(r.logged.length, 1, 'exactly one save per tap');
  const p = r.logged[0][1];
  assert.strictEqual(p.attribution_channel, 'instagram');
  assert.strictEqual(p.attribution_night_code, null, 'filled by hand, not asked here');
  assert.strictEqual(p.attribution_referred_by, null, 'filled by hand, not asked here');
  assert.strictEqual(p.order_id, 'BOR-10042', 'answer joins to the order');
  assert.ok(p.attribution_answered_at, 'timestamp set');
  assert.strictEqual(p.attribution_source, 'order_confirmation');
  assert.ok(/شكراً/.test(r.ids.state.textContent), 'customer sees a thank you');
});

t('every one of the seven options saves its own option id', () => {
  for (const s of SLUGS) {
    const r = run();
    r.pick(s);
    assert.strictEqual(r.logged[0][1].attribution_channel, s, s + ' saves as ' + s);
  }
});

t('we store the option id, never the Arabic string', () => {
  const r = run();
  r.pick('game_night');
  const p = r.logged[0][1];
  assert.strictEqual(p.attribution_channel, 'game_night');
  assert.ok(!/[؀-ۿ]/.test(JSON.stringify(p)), 'no Arabic text travels in the payload');
});

t('changing the answer overwrites it and keeps one answer per order', () => {
  const r = run();
  r.pick('tiktok');
  r.pick('friend');
  assert.strictEqual(r.logged.length, 2, 'each tap saves');
  assert.strictEqual(r.logged[1][1].attribution_channel, 'friend', 'the last tap is the answer');
  assert.strictEqual(r.logged[1][1].order_id, 'BOR-10042');
});

t('live mode POSTs the payload to the order endpoint', () => {
  const r = run({ live: true });
  r.pick('search');
  assert.strictEqual(r.fetches.length, 1);
  assert.strictEqual(r.fetches[0].url, '/api/orders/attribution');
  assert.strictEqual(r.fetches[0].body.attribution_channel, 'search');
});

t('a failed write is not silent: it queues locally and offers a retry', async () => {
  const r = run({ live: true, fetchOk: false });
  r.pick('facebook');
  await new Promise(res => setImmediate(res));
  const q = JSON.parse(r.store['bordiiiz.attribution.queue']);
  assert.strictEqual(q.length, 1, 'answer queued, not lost');
  assert.strictEqual(q[0].attribution_channel, 'facebook');
  assert.ok(/ما كَدرنا نحفظها/.test(r.ids.state.textContent), 'customer is told, in Arabic');
  assert.ok(/طلبك مدفوع/.test(r.ids.state.textContent), 'no dead end: the order is safe and the page says so');
  assert.ok(r.ids.state.children.some(c => c.tagName === 'button'), 'a retry button exists');
});

t('the retry button re-sends the queued answer', async () => {
  const r = run({ live: true, fetchOk: false });
  r.pick('other');
  await new Promise(res => setImmediate(res));
  r.ids.state.children.find(c => c.tagName === 'button').dispatch('click', {});
  await new Promise(res => setImmediate(res));
  assert.strictEqual(r.fetches.length, 2, 'retry sent a second time');
});

console.log('\n' + pass + ' checks passed.');
