# Chat, Link-First Join, and Presence Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the stuck "Partner disconnected" banner, switch the join flow to invite-links, and add an always-visible per-round chat panel.

**Architecture:** Extends the shipped game on `main`. Presence truth moves from enter/leave deltas to a `presence.get()` re-query with a 3s grace timer, all in `src/wire.js`. Chat is a new `chat` wire message + a `chatMessages` array in the pure `Game` state (mirrors the guess-list pattern), rendered by a new always-on panel with a draft-preserving append path in `main.js`. Join UX is a `screenHome`/`screenLobby` rewrite around an invite URL.

**Tech Stack:** vanilla JS, Vite 5, Vitest 2.x (`vi.advanceTimersByTimeAsync` available), `ably` v2. Node test environment (no DOM tests).

**Spec:** `docs/superpowers/specs/2026-08-29-chat-and-ux-improvements-design.md`

## Global Constraints

- `src/game.js` stays pure: imports only `./presets.js`; no `ably`, DOM, network, or timers.
- The 3s grace timer and the `presence.get()` re-query live in `src/wire.js`. `game.js` only toggles `partnerPresent` on the synthetic `partner_here` / `partner_left` messages (unchanged).
- `PARTNER_GRACE_MS = 3000` (module const in `src/wire.js`).
- `src/ui.js` stays logic-free: it reads `state` and calls `actions.*`; it may hold local input/form state the way existing screens do. No state mutation, no wire-message construction.
- `chat` wire payload is exactly `{ text }`. `chatMessages` entries are exactly `{ mine: boolean, text: string }`. `chatMessages` is NEVER included in `snapshot()`.
- Chat text: `String(text).trim().slice(0, 280)`; empty result ⇒ no message, `sendChat` returns `[]`.
- `chatMessages` clears at every round boundary — the same places `guesses` clears: `freshRound()`, `startRound()`, and the `round_start` receive case.
- Invite URL: `location.origin + location.pathname + '#' + game.state.roomCode`.
- ES modules, `.js` import extensions.
- Full `npm test` green after every task. `npx vite build` clean after the `ui.js` and `main.js` tasks.
- Commit after every task with a `feat:` / `fix:` / `test:` / `docs:` prefix.
- TDD where a task has unit tests: failing test first, then implementation.

## Execution note

Work in an isolated worktree branched from `main` (per superpowers:using-git-worktrees). `npm install` in it first; baseline `npm test` must be green (59 tests) before Task 1.

---

## File Structure

| Path | Change |
|---|---|
| `src/game.js` | + `chatMessages` state, `sendChat()`, `receive('chat')`, clear points. |
| `src/wire.js` | + `'chat'` in `WIRE_TYPES`; rewrite presence handling (re-query + grace timer). |
| `src/realtime.js` | `onPresence(handler)` (no event arg) + new `async otherMembers()`. |
| `src/ui.js` | Rewrite `screenHome` + `screenLobby`; + `renderChat()`, `appendChatMessages()` (exported), chat wired into `render()`. |
| `src/main.js` | + `inviteUrl`, `shareInvite` / `sendChat` actions, chat-append fast path in `paint()`. |
| `src/style.css` | + chat panel rules; minor Home/Lobby rules. |
| `test/game.test.js` | + chat describe block. |
| `test/fake-realtime.js` | Presence model → shared membership + `otherMembers()`; `onPresence(handler)`. |
| `test/fake-realtime.test.js` | Rewrite presence tests to the new surface. |
| `test/realtime.test.js` | Update `onPresence` test; + `otherMembers()` test. |
| `test/wire.test.js` | NEW — join-order + grace-timer wiring tests. |
| `test/integration.test.js` | Update to new fake presence surface; + chat-through-wire test. |
| `test/reconnect.test.js` | Update to new fake presence surface. |
| `README.md` | Feature blurb + smoke checklist additions. |

---

## Task 1: `game.js` — chat state, `sendChat`, `receive('chat')`

**Files:**
- Modify: `src/game.js`
- Modify: `src/wire.js` (one line)
- Test: `test/game.test.js` (append)

**Interfaces:**
- Consumes: existing `Game`.
- Produces:
  - `game.state.chatMessages: Array<{ mine: boolean, text: string }>` — always present, starts `[]`.
  - `game.sendChat(text: string): Array<{type,payload}>` — trims + caps text to 280; empty ⇒ returns `[]` and pushes nothing; else pushes `{ mine: true, text }`, `_emit()`, returns `[{ type: 'chat', payload: { text } }]`.
  - `receive` `case 'chat'`: pushes `{ mine: false, text: payload.text }`, `_emit()`. No role/phase gate.
  - `chatMessages` reset to `[]` in `freshRound()`, `startRound()`, and the `round_start` receive branch.
  - `'chat'` appended to `WIRE_TYPES` in `src/wire.js`.
  - `snapshot()` unchanged — must NOT gain a `chatMessages` key.

- [ ] **Step 1: Write the failing tests (append to `test/game.test.js`)**

```js
describe('chat', () => {
  it('sendChat appends a mine=true message and returns one trimmed chat message', () => {
    const g = new Game({ role: 'setter' });
    const res = g.sendChat('  hey there  ');
    expect(g.state.chatMessages).toEqual([{ mine: true, text: 'hey there' }]);
    expect(res).toEqual([{ type: 'chat', payload: { text: 'hey there' } }]);
  });

  it('sendChat caps text at 280 characters', () => {
    const g = new Game({ role: 'guesser' });
    const res = g.sendChat('x'.repeat(500));
    expect(g.state.chatMessages[0].text).toHaveLength(280);
    expect(res[0].payload.text).toHaveLength(280);
  });

  it('sendChat ignores empty / whitespace-only text', () => {
    const g = new Game({ role: 'setter' });
    expect(g.sendChat('   ')).toEqual([]);
    expect(g.sendChat('')).toEqual([]);
    expect(g.state.chatMessages).toEqual([]);
  });

  it('receive chat appends a mine=false message regardless of role or phase', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'finished';
    g.receive({ type: 'chat', payload: { text: 'lol' }, from: 'x' });
    expect(g.state.chatMessages).toEqual([{ mine: false, text: 'lol' }]);
  });

  it('snapshot never includes chatMessages', () => {
    const g = new Game({ role: 'setter' });
    g.sendChat('secret-ish banter');
    expect(g.snapshot()).not.toHaveProperty('chatMessages');
  });

  it('chatMessages clears on startRound', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'setup';
    g.sendChat('a');
    g.startRound({ preset: 'easy', secret: 5, message: 'm' });
    expect(g.state.chatMessages).toEqual([]);
  });

  it('chatMessages clears on round_start (guesser side)', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    g.receive({ type: 'chat', payload: { text: 'c' }, from: 'x' });
    g.receive({ type: 'round_start', payload: { preset: 'easy', min: 1, max: 20, roundNumber: 2 }, from: 'x' });
    expect(g.state.chatMessages).toEqual([]);
  });

  it('chatMessages clears on play_again and new_round', () => {
    const a = new Game({ role: 'setter' });
    a.state.phase = 'finished';
    a.receive({ type: 'chat', payload: { text: 'x' }, from: 'y' });
    a.playAgain();
    expect(a.state.chatMessages).toEqual([]);

    const b = new Game({ role: 'guesser' });
    b.state.phase = 'round_lost';
    b.receive({ type: 'chat', payload: { text: 'x' }, from: 'y' });
    b.receive({ type: 'new_round', payload: { roundNumber: 3 }, from: 'y' });
    expect(b.state.chatMessages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/game.test.js`
Expected: FAIL — `g.sendChat is not a function`, `chatMessages` undefined.

- [ ] **Step 3: Implement in `src/game.js`**

In `freshRound(state)`, add after `state.canConfirmWin = false;`:

```js
  state.chatMessages = [];
```

In the constructor `this.state = { … }`, add after `partnerPresent: false,`:

```js
      chatMessages: [],
```

In `startRound()`, add next to `this.state.guesses = [];`:

```js
    this.state.chatMessages = [];
```

In the `round_start` receive case, inside the `if (this.state.role === 'guesser') {` block, add next to `this.state.guesses = [];`:

```js
          this.state.chatMessages = [];
```

Add the method (place after `sendHint`):

```js
  sendChat(text) {
    const t = String(text).trim().slice(0, 280);
    if (!t) return [];
    this.state.chatMessages.push({ mine: true, text: t });
    this._emit();
    return [{ type: 'chat', payload: { text: t } }];
  }
```

Add the `case` in `receive`, before `default:`:

```js
      case 'chat': {
        this.state.chatMessages.push({ mine: false, text: payload.text });
        this._emit();
        break;
      }
```

- [ ] **Step 4: Add `'chat'` to `WIRE_TYPES` in `src/wire.js`**

```js
const WIRE_TYPES = [
  'hello', 'round_start', 'guess', 'hint', 'reveal',
  'play_again', 'new_round', 'resync', 'state_snapshot', 'round_lost', 'chat',
];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/game.test.js` — PASS.
Run: `npm test` — full suite green (was 59, now 59 + 8 new = 67; a task-specific count is fine as long as nothing regressed).

- [ ] **Step 6: Commit**

```bash
git add src/game.js src/wire.js test/game.test.js
git commit -m "feat: chat messages in Game state"
```

---

## Task 2: Presence fix — `realtime.js` API, `wire.js` re-query + grace, test double

**Files:**
- Modify: `src/realtime.js`
- Modify: `src/wire.js`
- Modify: `test/fake-realtime.js`
- Modify: `test/fake-realtime.test.js`
- Modify: `test/realtime.test.js`
- Create: `test/wire.test.js`
- Modify: `test/integration.test.js`
- Modify: `test/reconnect.test.js`

**Interfaces:**
- Consumes: `Game` (unchanged), `wire()`, the fake pair.
- Produces:
  - `realtime.onPresence(handler: () => void)` — subscribes to ALL presence actions; no `event` argument.
  - `realtime.otherMembers(): Promise<Array<{ clientId: string }>>` — members from `channel.presence.get()` excluding own `clientId`.
  - `wire(game, rt)`: same signature; internally replaces the two `onPresence('enter'|'leave')` handlers with one `onPresenceChange` (see spec) using `PARTNER_GRACE_MS = 3000`. It calls `onPresenceChange()` once immediately after subscribing.
  - `test/fake-realtime.js` `createFakeRealtimePair()`: unchanged signature; each client gains `async otherMembers()` and `onPresence(handler)` (no event arg); `enter()`/`leave()` mutate a **shared** membership set and fire every registered presence handler on a microtask. `send`/`on`/`clientId`/`connect`/`close` semantics unchanged.

- [ ] **Step 1: Read the current files**

Read `src/realtime.js`, `src/wire.js`, `test/fake-realtime.js`, `test/fake-realtime.test.js`, `test/realtime.test.js`, `test/integration.test.js`, `test/reconnect.test.js` in full before editing. Note exactly how the current fake delivers `send`/`on` payloads (the `from` field) and how integration/reconnect tests drive presence (`rt.enter()` / `rt.leave()`), so you preserve message-delivery behavior and only change presence.

- [ ] **Step 2: Write the failing `test/wire.test.js`**

```js
import { describe, it, expect, vi } from 'vitest';
import { Game } from '../src/game.js';
import { wire } from '../src/wire.js';
import { createFakeRealtimePair } from './fake-realtime.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('wire — presence', () => {
  it('a client that joins second still sees the partner as present', async () => {
    const [rtA, rtB] = createFakeRealtimePair();
    const gameA = new Game({ role: 'setter' });
    const gameB = new Game({ role: 'guesser' });
    wire(gameA, rtA);
    rtA.enter();
    await flush();
    wire(gameB, rtB);   // B wires AFTER A is already in the room
    rtB.enter();
    await flush();
    await flush();
    expect(gameB.state.partnerPresent).toBe(true);
    expect(gameA.state.partnerPresent).toBe(true);
  });

  it('a brief leave/enter within the grace period does not fire partner_left', async () => {
    vi.useFakeTimers();
    try {
      const [rtA, rtB] = createFakeRealtimePair();
      const gameA = new Game({ role: 'setter' });
      wire(gameA, rtA);
      wire(new Game({ role: 'guesser' }), rtB);
      rtA.enter();
      rtB.enter();
      await vi.advanceTimersByTimeAsync(0);
      expect(gameA.state.partnerPresent).toBe(true);
      rtB.leave();
      await vi.advanceTimersByTimeAsync(1000);
      rtB.enter();
      await vi.advanceTimersByTimeAsync(5000);
      expect(gameA.state.partnerPresent).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a sustained leave fires partner_left after the grace period', async () => {
    vi.useFakeTimers();
    try {
      const [rtA, rtB] = createFakeRealtimePair();
      const gameA = new Game({ role: 'setter' });
      wire(gameA, rtA);
      wire(new Game({ role: 'guesser' }), rtB);
      rtA.enter();
      rtB.enter();
      await vi.advanceTimersByTimeAsync(0);
      rtB.leave();
      await vi.advanceTimersByTimeAsync(3001);
      expect(gameA.state.partnerPresent).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/wire.test.js`
Expected: FAIL — `rt.otherMembers is not a function` / `onPresence` signature mismatch.

- [ ] **Step 4: Update `test/fake-realtime.js` presence model**

Keep `clientId`, `connect()`, `send()`, `on()`, `close()` exactly as they are. Replace the presence parts so a pair shares one membership set:

```js
export function createFakeRealtimePair() {
  const members = new Set();          // shared clientIds currently "present"
  const presenceListeners = [];       // shared: every client's onPresence handler

  const mk = (id) => ({
    clientId: id,
    // --- unchanged message plumbing (keep the existing implementation) ---
    // connect, send, on, close ...
    // --- new presence surface ---
    onPresence(handler) {
      presenceListeners.push(handler);
    },
    async otherMembers() {
      return [...members].filter((m) => m !== id).map((m) => ({ clientId: m }));
    },
    enter() {
      members.add(id);
      queueMicrotask(() => presenceListeners.forEach((fn) => fn()));
    },
    leave() {
      members.delete(id);
      queueMicrotask(() => presenceListeners.forEach((fn) => fn()));
    },
  });

  const a = mk('client-a');
  const b = mk('client-b');
  // wire the two together for send/on exactly as before (peer refs etc.)
  return [a, b];
}
```

Preserve whatever peer-linking the current implementation uses for `send`/`on`; only the presence members above are new. `close()` should also `members.delete(id)`.

- [ ] **Step 5: Rewrite presence tests in `test/fake-realtime.test.js`**

Keep the message-delivery tests as they are (adjust only if the peer-linking refactor renamed something). Replace any `onPresence('enter', …)` / bare `enter()` expectations with:

```js
it('otherMembers reflects the peer once both have entered', async () => {
  const [a, b] = createFakeRealtimePair();
  a.enter();
  b.enter();
  await flush();
  expect(await a.otherMembers()).toEqual([{ clientId: b.clientId }]);
  expect(await b.otherMembers()).toEqual([{ clientId: a.clientId }]);
});

it('onPresence handler fires on peer enter and leave', async () => {
  const [a, b] = createFakeRealtimePair();
  let calls = 0;
  a.onPresence(() => { calls++; });
  b.enter();
  await flush();
  b.leave();
  await flush();
  expect(calls).toBeGreaterThanOrEqual(2);
});

it('a client sees no other members before the peer enters', async () => {
  const [a] = createFakeRealtimePair();
  a.enter();
  await flush();
  expect(await a.otherMembers()).toEqual([]);
});
```

- [ ] **Step 6: Update `src/realtime.js`**

Replace `onPresence` and add `otherMembers`:

```js
    onPresence(handler) {
      channel.presence.subscribe(() => handler());
    },

    async otherMembers() {
      const members = await channel.presence.get();
      return members.filter((m) => m.clientId !== clientId);
    },
```

`connect()`, `send()`, `on()`, `close()` unchanged.

- [ ] **Step 7: Update `test/realtime.test.js`**

The stub's `channel.presence` needs `get` and its `subscribe` is now called with a single function. Adjust the existing presence test and add:

```js
it('onPresence subscribes to all presence actions with a bare handler', async () => {
  const { ctor, channel } = makeAblyStub();          // your existing stub factory
  const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
  await rt.connect();
  const handler = vi.fn();
  rt.onPresence(handler);
  expect(channel.presence.subscribe).toHaveBeenCalledWith(expect.any(Function));
  // simulate Ably firing a presence event
  channel.presence.subscribe.mock.calls[0][0]();
  expect(handler).toHaveBeenCalledTimes(1);
});

it('otherMembers excludes the own clientId', async () => {
  const { ctor, channel } = makeAblyStub();
  channel.presence.get = vi.fn().mockResolvedValue([
    { clientId: 'someone-else' },
    { clientId: null },
  ]);
  const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
  await rt.connect();
  const others = await rt.otherMembers();
  expect(others).toEqual([{ clientId: 'someone-else' }, { clientId: null }]);
});
```

If `makeAblyStub` in the file doesn't already provide `channel.presence.get`, add `get: vi.fn().mockResolvedValue([])` to it.

- [ ] **Step 8: Rewrite the presence handling in `src/wire.js`**

Keep the `WIRE_TYPES` loop and `publish` helper. Replace the two `rt.onPresence('enter'|'leave', …)` blocks with:

```js
const PARTNER_GRACE_MS = 3000;

export function wire(game, rt) {
  const publish = (msgs) => {
    for (const m of msgs || []) rt.send(m.type, m.payload);
  };
  for (const type of WIRE_TYPES) {
    rt.on(type, (payload, from) => publish(game.receive({ type, payload, from })));
  }

  let prevOthers = 0;
  let leaveTimer = null;

  const onPresenceChange = async () => {
    const others = (await rt.otherMembers()).length;
    if (others > 0) {
      if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
      game.receive({ type: 'partner_here', payload: {} });
      if (prevOthers === 0) {
        publish(game.hello());
        if (game.state.phase !== 'lobby') publish(game.resync());
      }
    } else if (prevOthers > 0 && !leaveTimer) {
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        game.receive({ type: 'partner_left', payload: {} });
      }, PARTNER_GRACE_MS);
    }
    prevOthers = others;
  };

  rt.onPresence(onPresenceChange);
  onPresenceChange();
}
```

- [ ] **Step 9: Update `test/integration.test.js` and `test/reconnect.test.js`**

These call `wire()` then drive presence with `rt.enter()` / `rt.leave()`. With the new async `onPresenceChange`, add an extra `await flush()` after each `enter()`/`leave()` where an assertion depends on the presence result. Do NOT change what the tests assert. If a reconnect test asserted `partnerPresent === false` immediately after a `leave()`, switch that block to `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(PARTNER_GRACE_MS + 1)` (import `PARTNER_GRACE_MS`? it is not exported — just use `3001`). Re-run until both files are green with unchanged intent.

- [ ] **Step 10: Add the chat-through-wire test to `test/integration.test.js`**

```js
it('chat reaches the partner (not the sender) and clears on a new round', async () => {
  const [rtA, rtB] = createFakeRealtimePair();
  const a = new Game({ role: 'setter' });
  const b = new Game({ role: 'guesser' });
  wire(a, rtA);
  wire(b, rtB);
  rtA.enter();
  rtB.enter();
  await flush();

  for (const m of a.sendChat('can i fit six slices')) rtA.send(m.type, m.payload);
  await flush();
  expect(b.state.chatMessages).toEqual([{ mine: false, text: 'can i fit six slices' }]);
  expect(a.state.chatMessages).toEqual([{ mine: true, text: 'can i fit six slices' }]);

  for (const m of a.startRound({ preset: 'easy', secret: 3, message: 'x' })) rtA.send(m.type, m.payload);
  await flush();
  expect(a.state.chatMessages).toEqual([]);
  expect(b.state.chatMessages).toEqual([]);
});
```

- [ ] **Step 11: Run the full suite**

Run: `npm test`
Expected: PASS — all files green, including the new `test/wire.test.js` and the updated fakes/integration/reconnect.

- [ ] **Step 12: Commit**

```bash
git add src/realtime.js src/wire.js test/
git commit -m "fix: derive partner presence from presence.get() with a grace period"
```

---

## Task 3: `ui.js` + `style.css` — link-first Home/Lobby, chat panel

**Files:**
- Modify: `src/ui.js`
- Modify: `src/style.css`
- Test: none (no DOM env). Verified by `npx vite build` + `npm test` unchanged + manual smoke.

**Interfaces:**
- Consumes: `state` (now has `chatMessages`), `actions` (will gain `shareInvite`, `sendChat` in Task 4).
- Produces:
  - `screenHome(actions)` — "Start a game" primary; muted "open the link" line; a `<details>` "or enter a code" wrapping the existing 5-char input + Join.
  - `screenLobby(state, actions)` — "Invite your partner" heading; primary "Copy invite link" → `actions.shareInvite(btnEl)`; small room code; "Copy code instead" text button → `actions.copyCode()`; waiting text + spinner.
  - `renderChat(state, actions)` — `div.chat-panel` > (`ul.chat-log` of `li.chat-msg.(mine|theirs)`, `form.chat-form` with `input.chat-input` + Send).
  - `export function appendChatMessages(container, messages)` — appends `li.chat-msg` for each; sets `.chat-log` `scrollTop = scrollHeight`; no-op if no `.chat-log`.
  - `render()` — after the screen, for phases `setup` / `playing` / `finished` / `round_lost`, append `renderChat(...)` and scroll its log to the bottom.

- [ ] **Step 1: Rewrite `screenHome`**

```js
function screenHome(actions) {
  const codeInput = el('input', { class: 'code-input', maxlength: '5', placeholder: 'CODE', autocapitalize: 'characters' });
  const joinForm = el('form', {
    class: 'join-row',
    onsubmit: (e) => { e.preventDefault(); actions.joinGame(codeInput.value.trim().toUpperCase()); },
  }, [codeInput, el('button', { class: 'secondary', type: 'submit' }, 'Join')]);
  return el('div', { class: 'screen' }, [
    el('h1', { class: 'title', text: 'Guess What' }),
    el('p', { class: 'tagline', text: 'A tiny number game for two.' }),
    el('button', { class: 'primary', onclick: () => actions.createGame() }, 'Start a game'),
    el('p', { class: 'muted', text: 'Got a link from your partner? Just open it.' }),
    el('details', { class: 'code-fallback' }, [
      el('summary', {}, 'or enter a code'),
      joinForm,
    ]),
  ]);
}
```

- [ ] **Step 2: Rewrite `screenLobby`**

```js
function screenLobby(state, actions) {
  return el('div', { class: 'screen' }, [
    el('h2', { text: 'Invite your partner' }),
    el('button', {
      class: 'primary',
      onclick: (e) => actions.shareInvite(e.currentTarget),
    }, 'Copy invite link'),
    el('div', { class: 'roomcode small', text: state.roomCode || '' }),
    el('button', { class: 'link-btn', type: 'button', onclick: () => actions.copyCode() }, 'Copy code instead'),
    el('p', { class: 'muted', text: 'Waiting for your partner to join…' }),
    el('div', { class: 'spinner' }),
  ]);
}
```

- [ ] **Step 3: Add `renderChat` and `appendChatMessages`**

```js
function chatMsgEl(m) {
  return el('li', { class: 'chat-msg ' + (m.mine ? 'mine' : 'theirs'), text: m.text });
}

function renderChat(state, actions) {
  const log = el('ul', { class: 'chat-log' }, state.chatMessages.map(chatMsgEl));
  const input = el('input', {
    class: 'chat-input', maxlength: '280', placeholder: 'Say something…', autocomplete: 'off',
  });
  const form = el('form', {
    class: 'chat-form',
    onsubmit: (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) { actions.sendChat(v); input.value = ''; }
    },
  }, [input, el('button', { class: 'secondary', type: 'submit' }, 'Send')]);
  return el('div', { class: 'chat-panel' }, [log, form]);
}

export function appendChatMessages(container, messages) {
  const log = container.querySelector('.chat-log');
  if (!log) return;
  for (const m of messages) log.append(chatMsgEl(m));
  log.scrollTop = log.scrollHeight;
}
```

- [ ] **Step 4: Wire chat into `render()`**

At the end of `render()`, after `container.append(screen);`:

```js
  if (['setup', 'playing', 'finished', 'round_lost'].includes(state.phase)) {
    container.append(renderChat(state, actions));
    const log = container.querySelector('.chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }
```

- [ ] **Step 5: Append chat + Home/Lobby CSS to `src/style.css`**

```css
.code-fallback { margin-top: 4px; }
.code-fallback summary { color: var(--muted); cursor: pointer; font-size: .9rem; list-style: none; }
.code-fallback summary::-webkit-details-marker { display: none; }
.code-fallback .join-row { margin-top: 10px; }
.roomcode.small { font-size: 1.4rem; letter-spacing: .25em; padding: 10px; border-style: solid; }
.link-btn { background: none; border: 0; color: var(--muted); text-decoration: underline; padding: 4px; align-self: center; }

.chat-panel { margin-top: 20px; border: 1px solid #eadfe4; border-radius: var(--radius); background: var(--card); overflow: hidden; }
.chat-log { list-style: none; margin: 0; padding: 12px; display: flex; flex-direction: column; gap: 6px; max-height: 40vh; overflow-y: auto; }
.chat-msg { max-width: 80%; padding: 8px 12px; border-radius: 14px; font-size: .95rem; word-wrap: break-word; }
.chat-msg.mine { align-self: flex-end; background: var(--accent); color: var(--accent-ink); border-bottom-right-radius: 4px; }
.chat-msg.theirs { align-self: flex-start; background: #f1e8ec; color: var(--ink); border-bottom-left-radius: 4px; }
.chat-form { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #eadfe4; }
.chat-input { flex: 1; font: inherit; padding: 10px 12px; border: 1px solid #eadfe4; border-radius: var(--radius); background: var(--bg); }
```

(If the shipped `style.css` uses different token names, match them — read the file first. `--accent`, `--accent-ink`, `--card`, `--ink`, `--bg`, `--muted`, `--radius` were the tokens as of the last build.)

- [ ] **Step 6: Verify**

Run: `npm test` — unchanged, green (Task 2's count).
Run: `npx vite build` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui.js src/style.css
git commit -m "feat: link-first Home/Lobby and an always-on chat panel"
```

---

## Task 4: `main.js` — invite URL, `shareInvite` / `sendChat`, draft-preserving chat repaint

**Files:**
- Modify: `src/main.js`
- Test: none. Verified by `npx vite build` + `npm test` unchanged + manual smoke.

**Interfaces:**
- Consumes: `appendChatMessages` from `./ui.js`; `game.state.chatMessages`.
- Produces:
  - `actions.shareInvite(btnEl?)` — `navigator.share({ url })` if available (swallow rejection), else `navigator.clipboard.writeText(url)`; if a button node is passed, swap its label to "Link copied ✓" for ~1.5s.
  - `actions.sendChat(text)` — `send(game.sendChat(text))`.
  - `paint()` — before its existing logic: if `phase` and `role` are unchanged since the last paint AND `partnerPresent` is unchanged AND `game.state.chatMessages.length > paintedChatLen`, call `appendChatMessages(app, game.state.chatMessages.slice(paintedChatLen))`, update `paintedChatLen`, and `return`. Every full `render()` sets `paintedChatLen = game.state.chatMessages.length`.

- [ ] **Step 1: Import `appendChatMessages`**

```js
import { render, appendChatMessages } from './ui.js';
```

- [ ] **Step 2: Add `inviteUrl` + the new actions**

Above `const actions = {`:

```js
const inviteUrl = () => location.origin + location.pathname + '#' + game.state.roomCode;
```

In the `actions` object:

```js
  shareInvite: async (btn) => {
    const url = inviteUrl();
    if (navigator.share) {
      try { await navigator.share({ url }); return; } catch (_) { /* fall through */ }
    }
    if (navigator.clipboard) { try { await navigator.clipboard.writeText(url); } catch (_) {} }
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Link copied ✓';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
  },
  sendChat: (text) => send(game.sendChat(text)),
```

- [ ] **Step 3: Add the chat fast path to `paint()`**

Replace the current `paint()` with:

```js
let painted = { phase: null, role: null, partnerPresent: null };
let paintedChatLen = 0;

function paint() {
  const s = game.state;
  const sameScreen = painted.phase === s.phase && painted.role === s.role;

  if (sameScreen && painted.partnerPresent === s.partnerPresent
      && s.chatMessages.length > paintedChatLen) {
    appendChatMessages(app, s.chatMessages.slice(paintedChatLen));
    paintedChatLen = s.chatMessages.length;
    return;
  }

  const presenceOnly = sameScreen && painted.partnerPresent !== s.partnerPresent;
  painted = { phase: s.phase, role: s.role, partnerPresent: s.partnerPresent };
  if (presenceOnly && s.phase === 'setup' && s.role === 'setter') return;
  render(app, s, actions);
  paintedChatLen = s.chatMessages.length;
}
```

- [ ] **Step 4: Verify**

Run: `npm test` — unchanged, green.
Run: `npx vite build` — clean.
Run: `npm run dev`, open the app: Home shows "Start a game" + collapsed "or enter a code"; clicking it goes to a Lobby with "Copy invite link". No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat: invite-link sharing and draft-preserving chat repaint"
```

---

## Task 5: README + manual smoke checklist

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the feature blurb**

Add to the intro: an always-visible chat panel that clears each round, and that you invite your partner with a link (the URL carries the room code).

- [ ] **Step 2: Extend the manual smoke checklist**

Add these items (keep the existing ones):

```markdown
- [ ] Home: "Start a game" → Lobby shows "Copy invite link". Tapping it copies
      a URL ending in `#<CODE>` (or opens the share sheet on mobile).
- [ ] Open that link in the second browser → lands straight in the room, no
      Home screen, no typing.
- [ ] "or enter a code" on Home still works as a fallback.
- [ ] Chat: type a message on each side → it appears on the other side,
      right-aligned for the sender, left-aligned for the receiver.
- [ ] Type a half-finished chat message while the partner sends one → your
      draft is NOT cleared when theirs arrives.
- [ ] Start the next round → the chat panel is empty on both sides.
- [ ] Background one phone for ~2s and return → NO "partner disconnected"
      banner appears.
- [ ] Fully close one tab → the banner appears after ~3s; reopen the link →
      banner clears and the round resumes.
```

- [ ] **Step 3: Verify + commit**

Run: `npm test` — green.

```bash
git add README.md
git commit -m "docs: chat, invite links, and presence in the smoke checklist"
```

---

## Self-Review

**Spec coverage:**

| Spec element | Task |
|---|---|
| Presence: `otherMembers()` via `presence.get()` | 2 (realtime.js) |
| Presence: all-events `onPresence` | 2 (realtime.js) |
| Presence: re-query + `prevOthers` re-handshake in wire | 2 (wire.js) |
| Presence: 3s grace timer before `partner_left` | 2 (wire.js) + `test/wire.test.js` |
| Presence: join-order fixed (initial `onPresenceChange()`) | 2 + join-order test |
| `game.js` unchanged for presence | 2 (only synthetic msgs, as before) |
| Invite URL helper | 4 (main.js) |
| Home: "Start a game" + collapsed code entry | 3 (screenHome) |
| Lobby: "Copy invite link" (share/clipboard) + code backup | 3 (screenLobby) + 4 (shareInvite) |
| Chat state `chatMessages` + `{mine,text}` shape | 1 |
| `sendChat` trim/cap/empty rules | 1 + tests |
| `receive('chat')` no role/phase gate | 1 + test |
| chat clears at every round boundary | 1 + tests |
| `chat` in `WIRE_TYPES`, not in `snapshot()` | 1 + snapshot test |
| Always-on panel for setup/playing/finished/round_lost | 3 (render) |
| `renderChat` / `appendChatMessages` | 3 |
| Draft-preserving fast path in `paint()` | 4 |
| chat CSS, mobile-first | 3 (style.css) |
| fake-realtime new presence surface | 2 |
| join-order + debounce wiring tests | 2 (`test/wire.test.js`) |
| chat end-to-end through wire | 2 (integration.test.js) |
| integration/reconnect tests updated, intent unchanged | 2 |
| realtime.js `otherMembers`/`onPresence` tests | 2 (realtime.test.js) |
| README + smoke checklist | 5 |

No gaps.

**Placeholder scan:** No TBD/TODO; every code step has real code, every test step real assertions. Task 2 Step 4 references "the existing implementation" for `send`/`on` deliberately — the implementer is told to read and preserve it; the presence code it must write is given in full.

**Type consistency:**
- `game.state.chatMessages` entries `{ mine: boolean, text: string }` — used identically in game.js (Task 1), ui.js `chatMsgEl` (Task 3), and the fast path (Task 4).
- `chat` wire payload `{ text }` — produced by `sendChat` (Task 1), consumed by `receive('chat')` (Task 1) and the integration test (Task 2).
- `rt.otherMembers()` → `Promise<Array<{clientId}>>` — produced by realtime.js + fake (Task 2), consumed by `wire.js` `onPresenceChange` (Task 2) as `(await rt.otherMembers()).length`.
- `rt.onPresence(handler)` single-arg — realtime.js + fake + wire.js all Task 2, consistent.
- `actions.shareInvite(btnEl?)` — ui.js passes `e.currentTarget` (Task 3), main.js signature accepts optional node (Task 4).
- `actions.sendChat(text)` — ui.js form calls it (Task 3), main.js defines it (Task 4), game.js `sendChat` returns the wire array (Task 1).
- `appendChatMessages(container, messages)` — exported ui.js (Task 3), imported main.js (Task 4).
- `PARTNER_GRACE_MS = 3000` — defined in wire.js (Task 2); tests use the literal `3001`/`5000` rather than importing it.

No inconsistencies.
