// Runs the real <script> from confirmation.html against a minimal DOM shim.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const HTML = fs.readFileSync(process.argv[2], 'utf8');
const SRC = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

const IDS = [
  'attribution-form', 'followup-night', 'followup-thanks', 'referred-by',
  'thanks-save', 'state', 'oid',
  'night-opt-1', 'night-opt-2', 'night-opt-3', 'night-opt-4',
];

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
  const pickNight = (value, id) => {
    const t = ids[id] || makeEl('input');
    t.name = 'night'; t.value = value; t.checked = true;
    ids['attribution-form'].dispatch('change', { target: t });
  };
  const submit = () => ids['attribution-form'].dispatch('submit', { preventDefault() {} });

  return { ids, store, logged, fetches, pick, pickNight, submit };
}

// What a customer can actually read: drop script/style bodies and HTML comments,
// then every tag, so attribute values and source comments are not counted.
const visibleText = html => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]*>/g, ' ');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('Attribution capture — confirmation.html\n');

t('the seven options are in the order Customer Love asked for', () => {
  const block = HTML.match(/<div class="opts">([\s\S]*?)<\/div>/)[1];
  const values = [...block.matchAll(/name="channel" value="([a-z_]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(values, ['friend', 'game_night', 'instagram', 'tiktok', 'search', 'facebook', 'other']);
  const labels = [...block.matchAll(/<span>([^<]+)<\/span>/g)].map(m => m[1]);
  assert.deepStrictEqual(labels, [
    'A friend told me', 'I was at a game night', 'Instagram', 'TikTok',
    'Google or search', 'Facebook', 'Somewhere else',
  ]);
});

t('the superseded game-night wording is gone', () => {
  assert.ok(!/I saw it at a game night/.test(HTML), '"I saw it at a game night" must not survive');
  assert.ok(!/Other \(please specify\)/.test(HTML), '"Somewhere else" must not be relabelled');
});

t('no NIGHT-xx code is ever shown to a customer', () => {
  assert.ok(/value="NIGHT-01"/.test(HTML), 'the code lives in the value attribute');
  assert.ok(!/NIGHT-/.test(visibleText(HTML)), 'a code we invented must never render on screen');
});

t('the night picker offers the three nights plus "I do not remember"', () => {
  const block = HTML.match(/<div class="chips">([\s\S]*?)<\/div>/)[1];
  const values = [...block.matchAll(/name="night"[^>]*value="([A-Z0-9-]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(values, ['NIGHT-01', 'NIGHT-02', 'NIGHT-03', 'NIGHT-UNKNOWN']);
  const labels = [...block.matchAll(/<span>([^<]+)<\/span>/g)].map(m => m[1]);
  assert.deepStrictEqual(labels, ['Tue 14 Oct', 'Thu 22 Oct', 'Thu 29 Oct', 'I do not remember']);
});

t('nothing is pre-selected and nothing is saved on load', () => {
  const r = run();
  assert.strictEqual(r.logged.length, 0, 'no save before a tap');
  assert.strictEqual(r.ids['followup-night'].hidden, true, 'night picker starts hidden');
  assert.strictEqual(r.ids['followup-thanks'].hidden, true, 'thank-you starts hidden');
  assert.strictEqual(r.ids.state.hidden, true, 'no message before a tap');
  const preChecked = [...HTML.matchAll(/<input\b[^>]*>/g)].filter(m => /\schecked[\s/>=]/.test(m[0]));
  assert.deepStrictEqual(preChecked, [], 'no input carries a checked attribute');
});

t('one tap on a plain option saves the channel and shows no follow-up', () => {
  const r = run();
  r.pick('instagram');
  assert.strictEqual(r.logged.length, 1, 'exactly one save per tap');
  const p = r.logged[0][1];
  assert.strictEqual(p.attribution_channel, 'instagram');
  assert.strictEqual(p.attribution_night_code, null);
  assert.strictEqual(p.attribution_referred_by, null);
  assert.strictEqual(p.order_id, 'BOR-10042', 'answer joins to the order');
  assert.ok(p.attribution_answered_at, 'timestamp set');
  assert.strictEqual(p.attribution_source, 'order_confirmation');
  assert.strictEqual(r.ids['followup-night'].hidden, true, 'no extra line for Instagram');
  assert.strictEqual(r.ids['followup-thanks'].hidden, true);
  assert.ok(/thank you/i.test(r.ids.state.textContent), 'customer sees a thank you');
});

t('every one of the seven options saves its own slug', () => {
  const slugs = ['friend', 'game_night', 'instagram', 'tiktok', 'search', 'facebook', 'other'];
  for (const s of slugs) {
    const r = run();
    r.pick(s);
    assert.strictEqual(r.logged[0][1].attribution_channel, s, s + ' saves as ' + s);
  }
});

t('"A friend told me" reveals the thank-you line only', () => {
  const r = run();
  r.pick('friend');
  assert.strictEqual(r.ids['followup-thanks'].hidden, false);
  assert.strictEqual(r.ids['followup-night'].hidden, true, 'a friend referral is not a night');
});

t('"I was at a game night" reveals BOTH the night picker and the thank-you line', () => {
  const r = run();
  r.pick('game_night');
  assert.strictEqual(r.ids['followup-night'].hidden, false);
  assert.strictEqual(r.ids['followup-thanks'].hidden, false, 'most people at a table were brought by someone');
});

t('the channel is already stored before any follow-up is answered', () => {
  const r = run();
  r.pick('game_night');
  assert.strictEqual(r.logged.length, 1, 'channel saved on the tap, not on submit');
  assert.strictEqual(r.logged[0][1].attribution_channel, 'game_night');
  assert.strictEqual(r.logged[0][1].attribution_night_code, null, 'skipping the night costs nothing');
});

t('tapping a night saves its code with no save button', () => {
  const r = run();
  r.pick('game_night');
  r.pickNight('NIGHT-02', 'night-opt-2');
  assert.strictEqual(r.logged.length, 2, 'one tap, one save');
  assert.strictEqual(r.logged[1][1].attribution_night_code, 'NIGHT-02');
  assert.strictEqual(r.logged[1][1].attribution_channel, 'game_night');
  assert.strictEqual(r.logged[1][1].order_id, 'BOR-10042');
});

t('"I do not remember" is stored as NIGHT-UNKNOWN, not as null', () => {
  const r = run();
  r.pick('game_night');
  r.pickNight('NIGHT-UNKNOWN', 'night-opt-4');
  assert.strictEqual(r.logged[1][1].attribution_night_code, 'NIGHT-UNKNOWN');
});

t('a night code and a referrer are stored as two separate fields on one order', () => {
  const r = run();
  r.pick('game_night');
  r.pickNight('NIGHT-02', 'night-opt-2');
  r.ids['referred-by'].value = '  Omar  ';
  r.submit();
  const p = r.logged[2][1];
  assert.strictEqual(p.attribution_channel, 'game_night');
  assert.strictEqual(p.attribution_night_code, 'NIGHT-02');
  assert.strictEqual(p.attribution_referred_by, 'Omar', 'trimmed');
  assert.strictEqual(p.order_id, 'BOR-10042');
  assert.ok(/let them know/i.test(r.ids.state.textContent));
});

t('the thank-you name is stored against the same order for a friend referral', () => {
  const r = run();
  r.pick('friend');
  r.ids['referred-by'].value = 'Sara';
  r.submit();
  const p = r.logged[1][1];
  assert.strictEqual(p.attribution_channel, 'friend');
  assert.strictEqual(p.attribution_referred_by, 'Sara');
  assert.strictEqual(p.attribution_night_code, null);
});

t('changing the answer clears a stale night code and a stale name', () => {
  const r = run();
  r.pick('game_night');
  r.pickNight('NIGHT-01', 'night-opt-1');
  r.ids['referred-by'].value = 'Omar';
  r.pick('tiktok');
  assert.strictEqual(r.ids['referred-by'].value, '', 'stale name cleared');
  assert.strictEqual(r.ids['night-opt-1'].checked, false, 'stale night untapped');
  assert.strictEqual(r.ids['followup-night'].hidden, true);
  assert.strictEqual(r.ids['followup-thanks'].hidden, true);
  const p = r.logged[2][1];
  assert.strictEqual(p.attribution_channel, 'tiktok');
  assert.strictEqual(p.attribution_night_code, null, 'TikTok cannot carry a night code');
  assert.strictEqual(p.attribution_referred_by, null);
});

t('switching from a game night to a friend keeps the thank-you, drops the night', () => {
  const r = run();
  r.pick('game_night');
  r.pickNight('NIGHT-03', 'night-opt-3');
  r.pick('friend');
  assert.strictEqual(r.ids['followup-thanks'].hidden, false);
  assert.strictEqual(r.ids['followup-night'].hidden, true);
  assert.strictEqual(r.logged[2][1].attribution_night_code, null);
});

t('submitting with no option picked does nothing', () => {
  const r = run();
  r.submit();
  assert.strictEqual(r.logged.length, 0);
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
  assert.ok(/could not save/i.test(r.ids.state.textContent), 'customer is told');
  assert.ok(/already paid/i.test(r.ids.state.textContent), 'no dead end: order is safe');
  assert.ok(r.ids.state.children.some(c => c.tagName === 'button'), 'a retry button exists');
});

t('a failed night write queues the night code too', async () => {
  const r = run({ live: true, fetchOk: false });
  r.pick('game_night');
  r.pickNight('NIGHT-01', 'night-opt-1');
  await new Promise(res => setImmediate(res));
  const q = JSON.parse(r.store['bordiiiz.attribution.queue']);
  assert.ok(q.some(p => p.attribution_night_code === 'NIGHT-01'), 'night code queued, not lost');
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
