// Runs the real <script> from confirmation.html against a minimal DOM shim.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const HTML = fs.readFileSync(process.argv[2], 'utf8');
const SRC = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeEl(tag) {
  return {
    tagName: tag, id: '', name: '', type: '', value: '', className: '',
    hidden: false, disabled: false, children: [], _text: '',
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
  for (const id of ['attribution-form', 'followup', 'detail', 'detail-label', 'detail-hint', 'detail-save', 'state', 'oid']) {
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
  const submit = () => ids['attribution-form'].dispatch('submit', { preventDefault() {} });

  return { ids, store, logged, fetches, pick, submit };
}

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('Attribution capture — confirmation.html\n');

t('nothing is pre-selected and nothing is saved on load', () => {
  const r = run();
  assert.strictEqual(r.logged.length, 0, 'no save before a tap');
  assert.strictEqual(r.ids.followup.hidden, true, 'follow-up starts hidden');
  assert.strictEqual(r.ids.state.hidden, true, 'no message before a tap');
});

t('one tap on a plain option saves the channel and shows no follow-up', () => {
  const r = run();
  r.pick('instagram');
  assert.strictEqual(r.logged.length, 1, 'exactly one save per tap');
  const p = r.logged[0][1];
  assert.strictEqual(p.attribution_channel, 'instagram');
  assert.strictEqual(p.attribution_detail, null);
  assert.strictEqual(p.order_id, 'BOR-10042', 'answer joins to the order');
  assert.ok(p.attribution_answered_at, 'timestamp set');
  assert.strictEqual(p.attribution_source, 'order_confirmation');
  assert.strictEqual(r.ids.followup.hidden, true, 'no extra line for Instagram');
  assert.ok(/thank you/i.test(r.ids.state.textContent), 'customer sees a thank you');
});

t('every one of the seven options saves its own slug', () => {
  const slugs = ['friend', 'instagram', 'tiktok', 'game_night', 'search', 'facebook', 'other'];
  for (const s of slugs) {
    const r = run();
    r.pick(s);
    assert.strictEqual(r.logged[0][1].attribution_channel, s, s + ' saves as ' + s);
  }
});

t('"A friend told me" reveals the thank-you line with the agreed wording', () => {
  const r = run();
  r.pick('friend');
  assert.strictEqual(r.ids.followup.hidden, false);
  assert.strictEqual(r.ids['detail-label'].textContent, 'Who should we thank?');
  assert.strictEqual(r.ids['detail-hint'].textContent, 'Optional, first name is fine.');
});

t('"I saw it at a game night" asks for the night code (Growth attribution, BOR-6)', () => {
  const r = run();
  r.pick('game_night');
  assert.strictEqual(r.ids.followup.hidden, false);
  assert.ok(/code on the table card/i.test(r.ids['detail-label'].textContent));
  assert.ok(/NIGHT-01/.test(r.ids['detail-hint'].textContent));
});

t('the channel is already stored before the follow-up is answered — skipping it costs nothing', () => {
  const r = run();
  r.pick('friend');
  assert.strictEqual(r.logged.length, 1, 'channel saved on the tap, not on submit');
  assert.strictEqual(r.logged[0][1].attribution_channel, 'friend');
  assert.strictEqual(r.logged[0][1].attribution_detail, null);
});

t('the thank-you name is stored against the same order', () => {
  const r = run();
  r.pick('friend');
  r.ids.detail.value = '  Sara  ';
  r.submit();
  const p = r.logged[1][1];
  assert.strictEqual(p.attribution_channel, 'friend');
  assert.strictEqual(p.attribution_detail, 'Sara', 'trimmed');
  assert.strictEqual(p.order_id, 'BOR-10042');
  assert.ok(/let them know/i.test(r.ids.state.textContent));
});

t('the night code is stored in the same detail field', () => {
  const r = run();
  r.pick('game_night');
  r.ids.detail.value = 'NIGHT-01';
  r.submit();
  assert.strictEqual(r.logged[1][1].attribution_detail, 'NIGHT-01');
});

t('changing the answer re-saves and clears a stale detail', () => {
  const r = run();
  r.pick('friend');
  r.ids.detail.value = 'Sara';
  r.pick('tiktok');
  assert.strictEqual(r.ids.detail.value, '', 'stale name cleared');
  assert.strictEqual(r.ids.followup.hidden, true);
  assert.strictEqual(r.logged[1][1].attribution_channel, 'tiktok');
  assert.strictEqual(r.logged[1][1].attribution_detail, null);
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

t('the retry button re-sends the queued answer', async () => {
  const r = run({ live: true, fetchOk: false });
  r.pick('other');
  await new Promise(res => setImmediate(res));
  r.ids.state.children.find(c => c.tagName === 'button').dispatch('click', {});
  await new Promise(res => setImmediate(res));
  assert.strictEqual(r.fetches.length, 2, 'retry sent a second time');
});

console.log('\n' + pass + ' checks passed.');
