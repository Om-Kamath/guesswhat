# Guess-the-Number Game for Long-Distance Couples — Design

**Date:** 2026-08-28
**Status:** Approved design, pending implementation plan

## Overview

A real-time, two-player number-guessing game for a couple. One person (the
**Setter**) secretly picks a number within a chosen range and writes a hidden
message. The other person (the **Guesser**) tries to find the number. After each
guess, the Setter manually taps a **↑ Higher** or **↓ Lower** arrow to send a
hint — the app does not enforce that hints are truthful (playful lying is
intentional). When the Guesser lands on the exact number, the app detects the
win, reveals the hidden message, and offers a rematch with roles swapped.

## Goals

- Two people, physically apart, play together in real time (sub-second hints).
- No accounts, no login. Connect via a short room code.
- Setter chooses one of three difficulty presets per round.
- Setter attaches a hidden **text** message revealed only on a correct guess.
- Roles swap each round.
- Free hosting: Vercel static site + Ably free tier.

## Non-Goals (v1)

- No asynchronous / turn-based play — real-time only.
- No persistent accounts or couple-pairing.
- No photo/file upload in the reveal — text only.
- No score tally across rounds, no timers, no give-up button.
- No database. No server-side game state.
- No automatic validation of hint truthfulness.
- No browser-automation / E2E test harness.
- No persistence of a round across a Setter page reload (round is lost — see
  "Setter refresh").

## Architecture

**Stack:** Plain HTML/CSS/vanilla JS, built with Vite, deployed as a Vercel
static site. One Vercel serverless function. Ably JS SDK in the browser.

**Transport (chosen approach "A"):** Ably is a dumb pub/sub relay. The room code
*is* the Ably channel name. No backend game logic, no database. The secret
number and hidden message never leave the Setter's browser tab; the Guesser's
client only ever receives the range, the hints, and the final reveal.

**Handshake:** Ably presence drives the `hello` exchange. On channel attach and
on every peer `enter`, a client re-broadcasts `hello { role }` (and, if not in
`lobby`, a rejoining client also sends `resync`). This makes the exchange robust
to either player joining first or reconnecting. A client whose role is unknown
(a refreshed tab) sends `hello { role: null }`; the established peer replies with
its own `hello` so the refreshed client can resolve its role as the opposite.

### Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `/api/ably-token` (serverless) | Returns a short-lived Ably token request so the Ably API key stays server-side. | `ABLY_API_KEY` env var |
| `realtime.js` | Thin wrapper over Ably: connect, join a channel by room code, `send(type, payload)`, `on(type, handler)`, presence enter/leave. Nothing game-specific. | Ably SDK, `/api/ably-token` |
| `game.js` | The state machine: current phase, role, preset, range, secret (Setter only), reveal message (Setter only), guess history, hint history, round number. Pure logic, no DOM, no network. | nothing |
| `ui.js` | Renders the current screen from game state; wires buttons to `game.js` + `realtime.js`. Only module that touches the DOM. | `game.js`, `realtime.js` |
| `main.js` | Bootstrap: read room code from URL or input, choose role, wire the three modules together. | all |

**Rationale for the split:** `game.js` is unit-testable in isolation (feed it
messages, assert state). `realtime.js` can be replaced with an in-memory fake in
tests. `ui.js` isolates all DOM work.

## Roles & Game Flow

- **Setter:** whoever creates the room (round 1). **Guesser:** whoever joins.
- Roles swap every round on "Play again".

### Phases

A single phase enum, shared by both clients; each client renders the view for
its own role.

1. **`lobby`**
   - Creator: shows room code + copy button + "waiting for partner…".
   - Joiner: room-code input.
   - Both advance to `setup` once each client has seen the other role's `hello`.

2. **`setup`**
   - Setter: picks a preset (Easy 1–20 / Medium 1–100 / Hard 1–1000), enters a
     secret number within range (inline validation), types the hidden reveal
     message, taps "Start round".
   - Guesser: "Your partner is picking a number…".
   - On start, Setter broadcasts `round_start` carrying **only** the preset and
     range (never the number or message).

3. **`playing`**
   - Guesser: range header ("Guess a number between MIN and MAX"), number input,
     "Guess" button, and a reverse-chronological list of past guesses each
     tagged with a green ↑ or red ↓ chip once the hint arrives.
   - Setter: secret pinned at top, live incoming guess list, two full-width
     arrow buttons **↑ Higher** / **↓ Lower** that each broadcast a `hint`.
   - Win detection: when an incoming guess equals the secret, the Setter's two
     arrows are replaced by a single **🎉 They got it!** button, which
     broadcasts `reveal` (including the hidden message) and moves both clients
     to `finished`.

4. **`finished`**
   - Both: "Got it in N guesses!" + the revealed message in a card + "Play
     again" (swaps roles, `roundNumber++`, back to `setup`).

## Message Protocol

Published to the Ably channel named after the room code. Envelope:
`{ type, payload, from }`, where `from` is a random per-session client ID.

| `type` | Sender | Payload | Effect on receiver |
|---|---|---|---|
| `hello` | both, on join | `{ role }` | Presence handshake; once a client has seen the other role, it moves `lobby → setup`. |
| `round_start` | Setter | `{ preset, min, max, roundNumber }` | Guesser → `playing`. No secret, no message. |
| `guess` | Guesser | `{ value, guessNumber }` | Setter appends to its guess list; Guesser also appends to its own list. |
| `hint` | Setter | `{ direction: "higher" \| "lower", forGuessNumber }` | Guesser tags that guess with ↑ / ↓. |
| `reveal` | Setter | `{ message, totalGuesses }` | Both → `finished`. |
| `play_again` | either | `{ roundNumber }` | Both swap roles, adopt `roundNumber`, → `setup`. |
| `new_round` | either | `{ roundNumber }` | Both keep roles, adopt `roundNumber`, → `setup`. Used after a lost round. |
| `resync` | rejoining client | `{}` | Other client replies with `hello` + `state_snapshot`. |
| `state_snapshot` | responding client | `{ phase, preset, min, max, roundNumber, guesses, revealedMessage, totalGuesses }` | Rejoining client rebuilds its view. Never includes the secret or the pre-win reveal message. |
| `round_lost` | the client that detected it | `{}` | Both → `round_lost` screen ("New round" button sends `new_round`). |

## Connection & Error Handling

- **Ably token fetch or connect fails:** full-screen "Can't connect. Retry"
  button. No partial UI is shown.
- **Partner drops (Ably presence `leave`):** a banner strip under the header —
  "Partner disconnected — waiting for them to come back…". In-memory state is
  preserved; the screen is not torn down.
- **Partner rejoins:** the reconnecting client broadcasts `resync`; the other
  client replies with `state_snapshot`, and the rejoiner rebuilds its view.
- **Setter refresh mid-round:** the room code is mirrored into the URL hash
  (`#ABCDE`), so a reload reconnects to the same channel. But the secret number
  and reveal message lived only in that tab and are gone. On reconnect the
  refreshed client sends `resync`, receives a `state_snapshot` whose phase is
  `playing`, resolves its own role to `setter`, finds its `secret` is null, and
  declares the round lost: it broadcasts `round_lost` and both players see
  "Round lost — the setter's page was reloaded" with a "New round" button
  (sends `new_round`; returns to `setup` with roles unchanged). This is an
  accepted v1 limitation of approach A.
- **Bad room code:** joining a channel that has no other participant simply
  keeps the joiner in `lobby` with "waiting for partner…"; there is no error
  state for a mistyped code beyond that. (Manual smoke test covers it.)

## UI / Screens

Mobile-first, portrait, single column, large touch targets.

1. **Home** — "Create game" button + "Join with code" input. "Create game"
   generates a random 5-character room code client-side (uppercase letters +
   digits, ambiguous characters like O/0/I/1 excluded) and moves to Lobby.
2. **Lobby** — large room code with copy button; "waiting for partner" spinner.
3. **Setup** — Setter: 3 preset cards, secret-number field with inline range
   validation, reveal-message textarea, "Start round". Guesser: waiting state.
4. **Playing** — as described in the Phases section (distinct Setter/Guesser
   views).
5. **Finished** — "Got it in N guesses!", revealed message card, "Play again".

**Visual direction:** warm, affectionate, playful — not a sterile utility.
Rounded cards, a soft accent color, a gentle celebration animation on the win
screen. The `frontend-design` skill will be used during implementation so the
result reads as intentional rather than template-default. Connection banners
appear as a strip under the header without tearing down the current screen.

## Testing

- **`game.js` (state machine) — unit tests, the bulk of coverage.** Feed
  sequences of inbound messages; assert phase transitions, guess/hint history,
  role swaps, win detection, and that a Guesser-role instance is never given a
  secret. Vitest, no browser.
- **`realtime.js` — tested against an in-memory fake Ably channel** so two
  `game.js` instances can play a full round with no network.
- **Integration test:** a scripted full round — create, join, setup, several
  guesses with hints, exact-match win, reveal, play-again-with-role-swap — run
  through the fake channel, asserting both clients end in `finished` with
  matching guess counts.
- **Manual smoke checklist (in README):** real two-device round; partner
  disconnect banner; Setter-refresh "round lost"; mistyped room code.
- TDD throughout: `game.js` logic gets its tests written first.

## Deployment

- Vercel static site (Vite build output).
- One serverless function: `/api/ably-token`.
- Env var: `ABLY_API_KEY` (set in Vercel project settings).
- Ably free tier (6M messages/month — far beyond two players).
