# Chat, Link-First Join, and Presence Fix — Design

**Date:** 2026-08-29
**Status:** Approved design, pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-08-28-guess-number-game-design.md` (the shipped game, now on `main`)

## Overview

Three changes surfaced by real-world play-testing of the deployed app:

1. **Presence fix** — the "Partner disconnected" banner shows (and sticks) even
   though the game works. Root cause: `channel.presence.subscribe('enter')` only
   fires for members who join *after* the local client subscribes, so whoever is
   second into the room never registers the first person, and `partnerPresent`
   never becomes true. Transient mobile disconnects then leave it stuck.
2. **Link-first join** — the current Home screen foregrounds a type-a-code field,
   which is confusing. Switch to an invite-link flow (the URL already carries
   `#CODE`), with typed-code entry as a minor fallback.
3. **Chat panel** — an always-visible chat beside/below the game so the two
   players can banter ("Can I fit this many slices in my mouth?"). Clears each
   round. No history replay on refresh.

## Goals

- `partnerPresent` reflects reality: true whenever another member is in the Ably
  channel, regardless of join order; false only after a sustained absence.
- Invite by tappable link; no typing a code in the common case.
- Free-text chat between the two players, always visible during a round.

## Non-Goals

- No chat history persistence or replay to a rejoining client.
- No unread badge / notifications (the panel is always visible).
- No per-message timestamps, delivery receipts, typing indicators, or emoji
  picker.
- No change to the game's phase machine, message protocol (beyond adding `chat`),
  or the reconnection/round-lost logic.
- No incremental-DOM framework — `render()` stays a full rebuild; only the
  high-frequency chat-append path is special-cased.

## Part 1: Presence fix

### Transport layer (`src/realtime.js`)

Replace the event-filtered presence subscription with a change-signal plus a
current-membership query:

- `onPresence(handler)` — subscribes to **all** presence actions
  (`channel.presence.subscribe(() => handler())`); fires on enter, leave, and
  update. (Drops the `event` argument.)
- `otherMembers()` — `async`; returns
  `(await channel.presence.get()).filter(m => m.clientId !== clientId)`.

`connect()` is unchanged (still `attach()` then `presence.enter({})`).

### Wiring layer (`src/wire.js`)

Replace the two `onPresence('enter'|'leave', …)` handlers with one
change-handler that re-queries membership and debounces disappearance:

```
const PARTNER_GRACE_MS = 3000;
let prevOthers = 0;
let leaveTimer = null;

const onPresenceChange = async () => {
  const others = (await rt.otherMembers()).length;
  if (others > 0) {
    if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
    game.receive({ type: 'partner_here', payload: {} });
    if (prevOthers === 0) {                 // a partner just appeared
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
onPresenceChange();   // initial sync — catches an already-present partner
```

`game.js` is unchanged: it still just toggles `partnerPresent` on the synthetic
`partner_here` / `partner_left` messages. The debounce and the join-order fix
live entirely in the wiring layer.

### Behaviour after the fix

- Second player into the room: initial `onPresenceChange()` finds the first
  player via `otherMembers()` → `partner_here` → banner never shows.
- Partner backgrounds their phone for < 3 s: `leave` then `enter`; the leave
  timer is cancelled before it fires → no banner flicker.
- Partner genuinely gone > 3 s: timer fires → `partner_left` → banner.
- Partner returns: `otherMembers()` > 0 → `partner_here` + re-handshake
  (`hello`, and `resync` if mid-round).

## Part 2: Link-first join

### Invite URL

`inviteUrl(code) = location.origin + location.pathname + '#' + code` (computed in
`src/main.js`; no new module). The `#CODE` reload path already exists in `boot()`.

### Home screen (`screenHome`)

- Title + tagline (unchanged copy).
- Primary button **"Start a game"** → `actions.createGame()`.
- Secondary muted line: "Got a link from your partner? Just open it."
- A collapsed `<details>` labelled "or enter a code" containing the existing
  5-char input + "Join" button → `actions.joinGame(code)`.

### Lobby screen (`screenLobby`)

- Heading "Invite your partner".
- Primary button **"Copy invite link"** → `actions.shareInvite()`:
  - if `navigator.share` exists, call it with `{ url: inviteUrl }` (mobile share
    sheet);
  - else `navigator.clipboard.writeText(inviteUrl)` and briefly swap the button
    label to "Link copied ✓".
- The raw room code shown small beneath, with a plain "Copy code" text button as
  backup (keeps `actions.copyCode`).
- "Waiting for your partner to join…" + spinner (unchanged).

### `main.js` actions

- `createGame` unchanged (generates code, `start(code, 'setter')`).
- Add `shareInvite()`; keep `copyCode()`.
- `joinGame` unchanged.

No change to `start()`, `boot()`, or the handshake.

## Part 3: Chat panel

### State (`src/game.js`)

- New field `chatMessages: []` — array of `{ mine: boolean, text: string }`.
- Cleared wherever `guesses` is cleared: in `freshRound()`, in `startRound()`,
  and in the `round_start` receive case. (Same lifetime as the guess list ⇒
  clears at every round boundary.)
- `sendChat(text)`:
  - `const t = String(text).slice(0, 280).trim(); if (!t) return [];`
  - push `{ mine: true, text: t }`, `_emit()`,
  - return `[{ type: 'chat', payload: { text: t } }]`.
- `receive` `case 'chat'`: push `{ mine: false, text: payload.text }`, `_emit()`.
  (No role gate — either player may chat in any phase.)

Echo is already disabled (`echoMessages: false`), so a client never receives its
own `chat` back; the local push in `sendChat` is the only copy it keeps.

### Wire (`src/wire.js`)

Add `'chat'` to `WIRE_TYPES`. Not added to `snapshot()` — no history replay.

### UI (`src/ui.js`)

- `renderChat(state, actions)` returns:
  - `div.chat-panel`
    - `ul.chat-log` — one `li.chat-msg` per message, extra class `mine` or
      `theirs`, text set via `textContent`.
    - `form.chat-form` — `input.chat-input` (`maxlength="280"`,
      `placeholder="Say something…"`) + `button` "Send". On submit: trimmed
      non-empty value → `actions.sendChat(value)`, clear the input.
- `render()`: after appending the screen, for phases `setup`, `playing`,
  `finished`, `round_lost`, also append `renderChat(state, actions)`. Not for
  `lobby` (one person) or Home.
- After `container.append(...)`, set `.chat-log`'s `scrollTop = scrollHeight`.
- `export function appendChatMessages(container, messages)` — find `.chat-log`;
  for each message append an `li.chat-msg.(mine|theirs)`; set
  `scrollTop = scrollHeight`. No-op if there is no `.chat-log` in the DOM.

### Draft-preserving repaint (`src/main.js`)

`paint()` gains a chat-append fast path so an incoming message never rebuilds the
input:

- Track `paintedChatLen` (count of chat messages last rendered). Reset it to
  `state.chatMessages.length` after every full `render()`.
- In `paint()`, before the existing logic: if `phase` and `role` are unchanged
  since last paint **and** `partnerPresent` is unchanged **and**
  `state.chatMessages.length > paintedChatLen`, call
  `appendChatMessages(app, state.chatMessages.slice(paintedChatLen))`, set
  `paintedChatLen`, and return without a full render.
- The existing `presenceOnly` setup-form guard is unchanged.

### Styling (`src/style.css`)

New rules for `.chat-panel`, `.chat-log`, `.chat-msg`, `.chat-msg.mine`,
`.chat-msg.theirs`, `.chat-form`, `.chat-input`. Mobile-first: panel is a
bordered box with a capped-height scrolling log (e.g. `max-height: 40vh`),
`mine` bubbles right-aligned in the accent colour, `theirs` left-aligned in a
neutral fill. Reuse existing palette tokens. Keep `color-scheme` behaviour.

## Testing

### `src/game.js` — unit (Vitest, node)

- `sendChat` pushes `{ mine: true }`, returns one `chat` message with trimmed
  text; caps at 280; returns `[]` for empty/whitespace.
- `receive('chat')` pushes `{ mine: false }` with the payload text; works
  regardless of `role` and `phase`.
- `chatMessages` is `[]` after `startRound`, after `round_start`, after
  `play_again`, after `new_round`.

### `test/fake-realtime.js` — test double changes

- Track a shared membership set keyed by `clientId`; `enter()` adds this client,
  `leave()` removes it, both then fire **every** client's presence handler.
- `onPresence(handler)` — single handler, no event arg.
- `otherMembers()` — `async`, returns the membership entries whose `clientId`
  differs from this client's.
- Update `test/fake-realtime.test.js` to the new surface.

### Wiring / integration

- **Join-order fix:** wire two clients; client A enters, THEN client B enters and
  wires. Assert B's `game.state.partnerPresent === true` (via the initial
  `onPresenceChange`) without any post-subscribe enter for A.
- **Debounce:** with `vi.useFakeTimers()`, a `leave` followed by an `enter`
  inside `PARTNER_GRACE_MS` leaves `partnerPresent === true` and never emits
  `partner_left`; a `leave` with no return, advanced past `PARTNER_GRACE_MS`,
  emits `partner_left`.
- Existing `test/integration.test.js` and `test/reconnect.test.js` updated to the
  new fake presence surface; their assertions unchanged in intent.

### Chat end-to-end

- Through `wire()` + the fake pair: A `sendChat("hi")` → B's `chatMessages` has
  one `{ mine: false, text: "hi" }`; A's has `{ mine: true, text: "hi" }`; no
  echo back to A.
- A new round (`round_start` / `play_again`) empties both clients' `chatMessages`.

### `src/realtime.js`

- `otherMembers()` filters out the own `clientId` from a stubbed
  `channel.presence.get()`.
- `onPresence(handler)` subscribes with no event filter.

### `src/ui.js`

Still no DOM test environment — `renderChat` / `appendChatMessages` covered by
the manual smoke checklist. Keep them logic-free (read `state`, call
`actions.*`).

## Deployment / docs

- `README.md`: add chat + link-invite to the feature blurb; extend the manual
  smoke checklist with: invite-link round-trip, chat both directions, chat clears
  on new round, backgrounding a phone briefly does NOT show the banner, a genuine
  close DOES show it after ~3 s.
- No new env vars, no `vercel.json` change.
