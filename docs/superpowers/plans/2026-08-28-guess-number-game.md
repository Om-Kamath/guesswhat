# Guess-the-Number Couples Game — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time two-player number-guessing game for a long-distance couple, hosted free on Vercel.

**Architecture:** Plain HTML/CSS/vanilla JS built with Vite, deployed as a Vercel static site with one serverless function (`/api/ably-token`). Ably is a dumb pub/sub relay; the room code is the channel name. All game logic lives client-side in a testable state machine (`src/game.js`); the secret number and hidden message never leave the Setter's browser.

**Tech Stack:** Vite 5, Vitest 2, `ably` 2.x (npm), vanilla ES modules, no framework. Node test environment (no jsdom).

**Spec:** `docs/superpowers/specs/2026-08-28-guess-number-game-design.md`

## Global Constraints

- Node environment for tests (`test.environment` unset / `node`). No jsdom, no DOM in tests.
- `src/game.js` must contain **zero** imports of `ably`, DOM APIs, or network code — pure logic only.
- The Guesser role must never receive `secret` or the pre-win reveal message over the wire or in a `state_snapshot`.
- Preset ranges are exactly: Easy `1–20`, Medium `1–100`, Hard `1–1000`.
- Room code: exactly 5 characters drawn from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `O`, `0`, `I`, `1`, `L`).
- Message envelope on the wire: `{ type: string, payload: object, from: string }`.
- Phase enum (exact strings): `lobby`, `setup`, `playing`, `finished`, `round_lost`.
- Role enum (exact strings): `setter`, `guesser`.
- ES modules everywhere (`"type": "module"` in `package.json`). Use `.js` extensions in relative imports.
- Commit after every task with a `feat:` / `test:` / `chore:` prefix.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Scripts, deps, `"type": "module"`. |
| `vite.config.js` | Vite + Vitest config. |
| `vercel.json` | Vercel build/output config. |
| `index.html` | Single page; mounts `#app`, loads `src/main.js`. |
| `src/presets.js` | The three difficulty presets → ranges. |
| `src/roomcode.js` | Generate / validate a 5-char room code. |
| `src/game.js` | The `Game` state machine. Pure logic. The heart of the app. |
| `src/realtime.js` | `createRealtime()` — thin Ably wrapper (token auth, publish, subscribe, presence). |
| `src/ui.js` | `render(container, state, actions)` — builds the DOM for the current phase. No unit tests. |
| `src/main.js` | Bootstrap: room code from URL/input, wire `Game` ↔ `realtime` ↔ `render`, presence handshake. |
| `src/style.css` | All styling. Mobile-first. |
| `api/ably-token.js` | Vercel serverless: returns an Ably `TokenRequest`. |
| `test/fake-realtime.js` | In-memory two-client realtime pair implementing the same interface as `createRealtime()`. |
| `test/game.test.js` | Unit tests for `Game`. |
| `test/roomcode.test.js` | Unit tests for room code. |
| `test/fake-realtime.test.js` | Tests the fake itself. |
| `test/realtime.test.js` | Tests `createRealtime()` against an injected Ably stub. |
| `test/integration.test.js` | Full round + role swap through the fake realtime. |
| `test/ably-token.test.js` | Tests the serverless handler against an injected Ably stub. |
| `README.md` | Setup, deploy, manual smoke checklist. |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `src/main.js` (stub), `test/smoke.test.js`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs Vitest; `npm run dev` serves the app.

- [ ] **Step 1: Create `.gitignore`**

```
node_modules
dist
.vercel
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "guesswhat",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  },
  "dependencies": {
    "ably": "^2.5.0"
  }
}
```

- [ ] **Step 3: Create `vite.config.js`**

```js
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
```

- [ ] **Step 4: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Guess What</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/main.js` stub**

```js
// Wired up in Task 14.
document.getElementById('app').textContent = 'loading…';
```

- [ ] **Step 6: Create `src/style.css` placeholder**

```css
/* Real styles land in Task 13. */
body { font-family: system-ui, sans-serif; margin: 0; }
```

- [ ] **Step 7: Write `test/smoke.test.js`**

```js
import { describe, it, expect } from 'vitest';

describe('test runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Install and run tests**

Run: `npm install && npm test`
Expected: PASS — 1 test passes.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + Vitest project"
```

---

## Task 2: Room code generation and validation

**Files:**
- Create: `src/roomcode.js`
- Test: `test/roomcode.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `generateRoomCode(): string` — 5 chars from the alphabet.
  - `isValidRoomCode(s: string): boolean` — true iff exactly 5 chars, all in the alphabet (case-insensitive input is uppercased by the caller, not here).
  - `ROOM_CODE_ALPHABET: string` — `"ABCDEFGHJKMNPQRSTUVWXYZ23456789"`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest';
import { generateRoomCode, isValidRoomCode, ROOM_CODE_ALPHABET } from '../src/roomcode.js';

describe('generateRoomCode', () => {
  it('returns 5 characters', () => {
    expect(generateRoomCode()).toHaveLength(5);
  });

  it('uses only alphabet characters', () => {
    for (let i = 0; i < 200; i++) {
      for (const ch of generateRoomCode()) {
        expect(ROOM_CODE_ALPHABET).toContain(ch);
      }
    }
  });

  it('excludes ambiguous characters', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[O0I1L]/);
  });
});

describe('isValidRoomCode', () => {
  it('accepts a well-formed code', () => {
    expect(isValidRoomCode('ABCDE')).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(isValidRoomCode('ABCD')).toBe(false);
    expect(isValidRoomCode('ABCDEF')).toBe(false);
  });

  it('rejects out-of-alphabet characters', () => {
    expect(isValidRoomCode('ABCD0')).toBe(false);
    expect(isValidRoomCode('abcde')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/roomcode.test.js`
Expected: FAIL — cannot resolve `../src/roomcode.js`.

- [ ] **Step 3: Write `src/roomcode.js`**

```js
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

export function generateRoomCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    out += ROOM_CODE_ALPHABET[idx];
  }
  return out;
}

export function isValidRoomCode(s) {
  if (typeof s !== 'string' || s.length !== CODE_LENGTH) return false;
  for (const ch of s) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/roomcode.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/roomcode.js test/roomcode.test.js
git commit -m "feat: room code generation and validation"
```

---

## Task 3: `Game` — construction, presets, lobby → setup handshake

**Files:**
- Create: `src/presets.js`, `src/game.js`
- Test: `test/game.test.js`

**Interfaces:**
- Consumes: `src/presets.js`.
- Produces:
  - `PRESETS: { easy|medium|hard: { label: string, min: number, max: number } }`.
  - `class Game`:
    - `new Game({ role?: 'setter'|'guesser'|null, roundNumber?: number })` — defaults: `role: null`, `roundNumber: 1`.
    - `game.state` — the live state object (see shape below). Never reassigned; mutated in place.
    - `game.onChange(fn: (state) => void)` — register a listener; called after every state mutation.
    - `game.hello(): Array<{type,payload}>` — returns `[{ type: 'hello', payload: { role } }]` (role may be null).
    - `game.receive({ type, payload, from }): Array<{type,payload}>` — applies an inbound message, returns zero or more outbound messages to publish.

  **`game.state` shape** (all keys always present):

  ```js
  {
    phase: 'lobby',          // 'lobby'|'setup'|'playing'|'finished'|'round_lost'
    role: null,              // 'setter'|'guesser'|null
    roundNumber: 1,
    preset: null,            // 'easy'|'medium'|'hard'|null
    min: null, max: null,    // number|null
    secret: null,            // number|null  — setter only, local
    revealMessage: null,     // string|null  — setter only, local (pre-win)
    guesses: [],             // Array<{ n: number, value: number, hint: 'higher'|'lower'|null }>
    revealedMessage: null,   // string|null  — both, after win
    totalGuesses: null,      // number|null
    canConfirmWin: false,    // setter only — latest guess equals secret
    partnerPresent: false,
  }
  ```

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { PRESETS } from '../src/presets.js';

const outbound = (res, type) => res.find((m) => m.type === type);

describe('PRESETS', () => {
  it('has the three exact ranges', () => {
    expect(PRESETS.easy).toMatchObject({ min: 1, max: 20 });
    expect(PRESETS.medium).toMatchObject({ min: 1, max: 100 });
    expect(PRESETS.hard).toMatchObject({ min: 1, max: 1000 });
  });
});

describe('Game construction', () => {
  it('starts in lobby with defaults', () => {
    const g = new Game();
    expect(g.state.phase).toBe('lobby');
    expect(g.state.role).toBe(null);
    expect(g.state.roundNumber).toBe(1);
  });

  it('accepts an explicit role and round number', () => {
    const g = new Game({ role: 'setter', roundNumber: 3 });
    expect(g.state.role).toBe('setter');
    expect(g.state.roundNumber).toBe(3);
  });
});

describe('onChange', () => {
  it('fires after receive mutates state', () => {
    const g = new Game({ role: 'setter' });
    let calls = 0;
    g.onChange(() => { calls++; });
    g.receive({ type: 'hello', payload: { role: 'guesser' }, from: 'x' });
    expect(calls).toBeGreaterThan(0);
  });
});

describe('hello handshake', () => {
  it('hello() announces our role', () => {
    const g = new Game({ role: 'setter' });
    expect(g.hello()).toEqual([{ type: 'hello', payload: { role: 'setter' } }]);
  });

  it('setter moves lobby -> setup when it sees the guesser', () => {
    const g = new Game({ role: 'setter' });
    g.receive({ type: 'hello', payload: { role: 'guesser' }, from: 'x' });
    expect(g.state.phase).toBe('setup');
    expect(g.state.partnerPresent).toBe(true);
  });

  it('a role-less (refreshed) client resolves its role from the peer', () => {
    const g = new Game({ role: null });
    g.receive({ type: 'hello', payload: { role: 'guesser' }, from: 'x' });
    expect(g.state.role).toBe('setter');
  });

  it('an established client replies with hello when the peer has no role', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'setup';
    const res = g.receive({ type: 'hello', payload: { role: null }, from: 'x' });
    expect(outbound(res, 'hello')).toEqual({ type: 'hello', payload: { role: 'guesser' } });
  });

  it('does not leave lobby until the opposite role is seen', () => {
    const g = new Game({ role: 'setter' });
    g.receive({ type: 'hello', payload: { role: 'setter' }, from: 'x' });
    expect(g.state.phase).toBe('lobby');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/game.test.js`
Expected: FAIL — cannot resolve `../src/game.js`.

- [ ] **Step 3: Write `src/presets.js`**

```js
export const PRESETS = {
  easy: { label: 'Easy', min: 1, max: 20 },
  medium: { label: 'Medium', min: 1, max: 100 },
  hard: { label: 'Hard', min: 1, max: 1000 },
};
```

- [ ] **Step 4: Write `src/game.js` (skeleton + hello handling)**

```js
import { PRESETS } from './presets.js';

const OPPOSITE = { setter: 'guesser', guesser: 'setter' };

function freshRound(state) {
  state.preset = null;
  state.min = null;
  state.max = null;
  state.secret = null;
  state.revealMessage = null;
  state.revealedMessage = null;
  state.totalGuesses = null;
  state.guesses = [];
  state.canConfirmWin = false;
}

export class Game {
  constructor({ role = null, roundNumber = 1 } = {}) {
    this.state = {
      phase: 'lobby',
      role,
      roundNumber,
      preset: null,
      min: null,
      max: null,
      secret: null,
      revealMessage: null,
      guesses: [],
      revealedMessage: null,
      totalGuesses: null,
      canConfirmWin: false,
      partnerPresent: false,
    };
    this._listeners = [];
    this._seenRoles = new Set();
    this._helpedPeer = false;
  }

  onChange(fn) {
    this._listeners.push(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this.state);
  }

  hello() {
    return [{ type: 'hello', payload: { role: this.state.role } }];
  }

  receive({ type, payload }) {
    const out = [];
    switch (type) {
      case 'hello': {
        this.state.partnerPresent = true;
        if (payload.role) {
          this._seenRoles.add(payload.role);
          if (!this.state.role) this.state.role = OPPOSITE[payload.role];
        } else if (this.state.role && !this._helpedPeer) {
          this._helpedPeer = true;
          out.push({ type: 'hello', payload: { role: this.state.role } });
        }
        if (
          this.state.phase === 'lobby' &&
          this.state.role &&
          this._seenRoles.has(OPPOSITE[this.state.role])
        ) {
          this.state.phase = 'setup';
        }
        this._emit();
        break;
      }
      default:
        break;
    }
    return out;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/game.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/presets.js src/game.js test/game.test.js
git commit -m "feat: Game state machine — lobby handshake"
```

---

## Task 4: `Game` — start round, `round_start`, enter `playing`

**Files:**
- Modify: `src/game.js`
- Test: `test/game.test.js` (append)

**Interfaces:**
- Consumes: Task 3 `Game`, `PRESETS`.
- Produces:
  - `game.startRound({ preset: 'easy'|'medium'|'hard', secret: number, message: string }): Array<{type,payload}>` — setter only, from `setup`. Sets `min`/`max` from the preset, stores `secret` + `revealMessage`, clears `guesses`, `phase → 'playing'`. Returns `[{ type: 'round_start', payload: { preset, min, max, roundNumber } }]`.
  - `receive` handles `round_start`: guesser only — adopts `preset`/`min`/`max`/`roundNumber`, clears `guesses`, `phase → 'playing'`.

- [ ] **Step 1: Write the failing tests (append to `test/game.test.js`)**

```js
describe('startRound', () => {
  it('setter enters playing and broadcasts range only', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'setup';
    const res = g.startRound({ preset: 'medium', secret: 42, message: 'i love you' });
    expect(g.state.phase).toBe('playing');
    expect(g.state.min).toBe(1);
    expect(g.state.max).toBe(100);
    expect(g.state.secret).toBe(42);
    expect(g.state.revealMessage).toBe('i love you');
    const msg = outbound(res, 'round_start');
    expect(msg.payload).toEqual({ preset: 'medium', min: 1, max: 100, roundNumber: 1 });
    expect(JSON.stringify(msg)).not.toContain('42');
    expect(JSON.stringify(msg)).not.toContain('love');
  });
});

describe('receive round_start', () => {
  it('guesser adopts the range and enters playing', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'setup';
    g.receive({ type: 'round_start', payload: { preset: 'hard', min: 1, max: 1000, roundNumber: 2 }, from: 'x' });
    expect(g.state.phase).toBe('playing');
    expect(g.state.min).toBe(1);
    expect(g.state.max).toBe(1000);
    expect(g.state.roundNumber).toBe(2);
  });

  it('setter ignores round_start', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'setup';
    g.receive({ type: 'round_start', payload: { preset: 'easy', min: 1, max: 20, roundNumber: 1 }, from: 'x' });
    expect(g.state.phase).toBe('setup');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/game.test.js`
Expected: FAIL — `g.startRound is not a function`.

- [ ] **Step 3: Implement in `src/game.js`**

Add this method to the `Game` class:

```js
  startRound({ preset, secret, message }) {
    const p = PRESETS[preset];
    this.state.preset = preset;
    this.state.min = p.min;
    this.state.max = p.max;
    this.state.secret = secret;
    this.state.revealMessage = message;
    this.state.guesses = [];
    this.state.canConfirmWin = false;
    this.state.phase = 'playing';
    this._emit();
    return [
      { type: 'round_start', payload: { preset, min: p.min, max: p.max, roundNumber: this.state.roundNumber } },
    ];
  }
```

Add this `case` to the `switch` in `receive`, before `default`:

```js
      case 'round_start': {
        if (this.state.role === 'guesser') {
          this.state.preset = payload.preset;
          this.state.min = payload.min;
          this.state.max = payload.max;
          this.state.roundNumber = payload.roundNumber;
          this.state.guesses = [];
          this.state.canConfirmWin = false;
          this.state.phase = 'playing';
        }
        this._emit();
        break;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/game.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game.js test/game.test.js
git commit -m "feat: Game — start round and enter playing"
```

---

## Task 5: `Game` — guesses and hints

**Files:**
- Modify: `src/game.js`
- Test: `test/game.test.js` (append)

**Interfaces:**
- Consumes: Task 4 `Game`.
- Produces:
  - `game.submitGuess(value: number): Array<{type,payload}>` — guesser only, from `playing`. Appends `{ n, value, hint: null }` where `n = guesses.length + 1`. Returns `[{ type: 'guess', payload: { value, guessNumber: n } }]`.
  - `game.sendHint(direction: 'higher'|'lower'): Array<{type,payload}>` — setter only. Sets `hint` on the most recent guess whose `hint` is `null`. Returns `[{ type: 'hint', payload: { direction, forGuessNumber } }]` (`forGuessNumber` is `null` if there is no un-hinted guess).
  - `receive` `guess`: setter only — appends `{ n: guessNumber, value, hint: null }`; if `value === secret`, sets `canConfirmWin = true`.
  - `receive` `hint`: guesser only — sets `hint` on the guess with matching `n`.

- [ ] **Step 1: Write the failing tests (append)**

```js
describe('guesses and hints', () => {
  it('guesser records its own guess and emits a guess message', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    const res = g.submitGuess(50);
    expect(g.state.guesses).toEqual([{ n: 1, value: 50, hint: null }]);
    expect(outbound(res, 'guess').payload).toEqual({ value: 50, guessNumber: 1 });
  });

  it('setter records an incoming guess', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    g.receive({ type: 'guess', payload: { value: 50, guessNumber: 1 }, from: 'x' });
    expect(g.state.guesses).toEqual([{ n: 1, value: 50, hint: null }]);
    expect(g.state.canConfirmWin).toBe(false);
  });

  it('setter flags canConfirmWin when a guess equals the secret', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    g.receive({ type: 'guess', payload: { value: 42, guessNumber: 3 }, from: 'x' });
    expect(g.state.canConfirmWin).toBe(true);
  });

  it('setter hint targets the latest un-hinted guess', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    g.receive({ type: 'guess', payload: { value: 50, guessNumber: 1 }, from: 'x' });
    g.receive({ type: 'guess', payload: { value: 25, guessNumber: 2 }, from: 'x' });
    const res = g.sendHint('higher');
    expect(outbound(res, 'hint').payload).toEqual({ direction: 'higher', forGuessNumber: 2 });
    expect(g.state.guesses[1].hint).toBe('higher');
    expect(g.state.guesses[0].hint).toBe(null);
  });

  it('guesser applies an incoming hint to the matching guess', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    g.submitGuess(50);
    g.receive({ type: 'hint', payload: { direction: 'lower', forGuessNumber: 1 }, from: 'x' });
    expect(g.state.guesses[0].hint).toBe('lower');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/game.test.js`
Expected: FAIL — `g.submitGuess is not a function`.

- [ ] **Step 3: Implement in `src/game.js`**

Add these methods to `Game`:

```js
  submitGuess(value) {
    const n = this.state.guesses.length + 1;
    this.state.guesses.push({ n, value, hint: null });
    this._emit();
    return [{ type: 'guess', payload: { value, guessNumber: n } }];
  }

  sendHint(direction) {
    let target = null;
    for (let i = this.state.guesses.length - 1; i >= 0; i--) {
      if (this.state.guesses[i].hint === null) {
        target = this.state.guesses[i];
        break;
      }
    }
    if (target) target.hint = direction;
    this._emit();
    return [{ type: 'hint', payload: { direction, forGuessNumber: target ? target.n : null } }];
  }
```

Add these `case`s to `receive`:

```js
      case 'guess': {
        if (this.state.role === 'setter') {
          this.state.guesses.push({ n: payload.guessNumber, value: payload.value, hint: null });
          if (payload.value === this.state.secret) this.state.canConfirmWin = true;
        }
        this._emit();
        break;
      }
      case 'hint': {
        if (this.state.role === 'guesser') {
          const g = this.state.guesses.find((x) => x.n === payload.forGuessNumber);
          if (g) g.hint = payload.direction;
        }
        this._emit();
        break;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/game.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game.js test/game.test.js
git commit -m "feat: Game — guesses and hints"
```

---

## Task 6: `Game` — confirm win, reveal, `finished`

**Files:**
- Modify: `src/game.js`
- Test: `test/game.test.js` (append)

**Interfaces:**
- Consumes: Task 5 `Game`.
- Produces:
  - `game.confirmWin(): Array<{type,payload}>` — setter only. `phase → 'finished'`, `revealedMessage = revealMessage`, `totalGuesses = guesses.length`, `canConfirmWin = false`. Returns `[{ type: 'reveal', payload: { message, totalGuesses } }]`.
  - `receive` `reveal`: both roles — `phase → 'finished'`, `revealedMessage = payload.message`, `totalGuesses = payload.totalGuesses`, `canConfirmWin = false`.

- [ ] **Step 1: Write the failing tests (append)**

```js
describe('confirm win and reveal', () => {
  it('setter confirmWin enters finished and broadcasts the message', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    g.state.revealMessage = 'call me tonight';
    g.receive({ type: 'guess', payload: { value: 42, guessNumber: 4 }, from: 'x' });
    const res = g.confirmWin();
    expect(g.state.phase).toBe('finished');
    expect(g.state.revealedMessage).toBe('call me tonight');
    expect(g.state.totalGuesses).toBe(1);
    expect(g.state.canConfirmWin).toBe(false);
    expect(outbound(res, 'reveal').payload).toEqual({ message: 'call me tonight', totalGuesses: 1 });
  });

  it('guesser applies an incoming reveal', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    g.submitGuess(42);
    g.receive({ type: 'reveal', payload: { message: 'call me tonight', totalGuesses: 6 }, from: 'x' });
    expect(g.state.phase).toBe('finished');
    expect(g.state.revealedMessage).toBe('call me tonight');
    expect(g.state.totalGuesses).toBe(6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/game.test.js`
Expected: FAIL — `g.confirmWin is not a function`.

- [ ] **Step 3: Implement in `src/game.js`**

Add to `Game`:

```js
  confirmWin() {
    this.state.phase = 'finished';
    this.state.revealedMessage = this.state.revealMessage;
    this.state.totalGuesses = this.state.guesses.length;
    this.state.canConfirmWin = false;
    this._emit();
    return [
      { type: 'reveal', payload: { message: this.state.revealMessage, totalGuesses: this.state.guesses.length } },
    ];
  }
```

Add `case` to `receive`:

```js
      case 'reveal': {
        this.state.phase = 'finished';
        this.state.revealedMessage = payload.message;
        this.state.totalGuesses = payload.totalGuesses;
        this.state.canConfirmWin = false;
        this._emit();
        break;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/game.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game.js test/game.test.js
git commit -m "feat: Game — confirm win and reveal"
```

---

## Task 7: `Game` — play again (role swap) and new round (no swap)

**Files:**
- Modify: `src/game.js`
- Test: `test/game.test.js` (append)

**Interfaces:**
- Consumes: Task 6 `Game`.
- Produces:
  - `game.playAgain(): Array<{type,payload}>` — from `finished`. Clears round fields, swaps `role`, `roundNumber += 1`, `phase → 'setup'`. Returns `[{ type: 'play_again', payload: { roundNumber } }]`.
  - `game.newRound(): Array<{type,payload}>` — from `round_lost`. Clears round fields, keeps `role`, `roundNumber += 1`, `phase → 'setup'`. Returns `[{ type: 'new_round', payload: { roundNumber } }]`.
  - `receive` `play_again`: both — clear round fields, swap `role`, `roundNumber = payload.roundNumber`, `phase → 'setup'`.
  - `receive` `new_round`: both — clear round fields, keep `role`, `roundNumber = payload.roundNumber`, `phase → 'setup'`.

- [ ] **Step 1: Write the failing tests (append)**

```js
describe('play again and new round', () => {
  it('playAgain swaps role and bumps the round', () => {
    const g = new Game({ role: 'setter', roundNumber: 1 });
    g.state.phase = 'finished';
    g.state.secret = 42;
    g.state.guesses = [{ n: 1, value: 42, hint: null }];
    const res = g.playAgain();
    expect(g.state.role).toBe('guesser');
    expect(g.state.roundNumber).toBe(2);
    expect(g.state.phase).toBe('setup');
    expect(g.state.secret).toBe(null);
    expect(g.state.guesses).toEqual([]);
    expect(outbound(res, 'play_again').payload).toEqual({ roundNumber: 2 });
  });

  it('receive play_again swaps the other side symmetrically', () => {
    const g = new Game({ role: 'guesser', roundNumber: 1 });
    g.state.phase = 'finished';
    g.receive({ type: 'play_again', payload: { roundNumber: 2 }, from: 'x' });
    expect(g.state.role).toBe('setter');
    expect(g.state.roundNumber).toBe(2);
    expect(g.state.phase).toBe('setup');
  });

  it('newRound keeps role and bumps the round', () => {
    const g = new Game({ role: 'setter', roundNumber: 4 });
    g.state.phase = 'round_lost';
    const res = g.newRound();
    expect(g.state.role).toBe('setter');
    expect(g.state.roundNumber).toBe(5);
    expect(g.state.phase).toBe('setup');
    expect(outbound(res, 'new_round').payload).toEqual({ roundNumber: 5 });
  });

  it('receive new_round keeps role', () => {
    const g = new Game({ role: 'guesser', roundNumber: 4 });
    g.state.phase = 'round_lost';
    g.receive({ type: 'new_round', payload: { roundNumber: 5 }, from: 'x' });
    expect(g.state.role).toBe('guesser');
    expect(g.state.roundNumber).toBe(5);
    expect(g.state.phase).toBe('setup');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/game.test.js`
Expected: FAIL — `g.playAgain is not a function`.

- [ ] **Step 3: Implement in `src/game.js`**

Add to `Game` (`freshRound` already exists at module scope from Task 3):

```js
  playAgain() {
    freshRound(this.state);
    this.state.role = OPPOSITE[this.state.role];
    this.state.roundNumber += 1;
    this.state.phase = 'setup';
    this._emit();
    return [{ type: 'play_again', payload: { roundNumber: this.state.roundNumber } }];
  }

  newRound() {
    freshRound(this.state);
    this.state.roundNumber += 1;
    this.state.phase = 'setup';
    this._emit();
    return [{ type: 'new_round', payload: { roundNumber: this.state.roundNumber } }];
  }
```

Add `case`s to `receive`:

```js
      case 'play_again': {
        freshRound(this.state);
        this.state.role = OPPOSITE[this.state.role];
        this.state.roundNumber = payload.roundNumber;
        this.state.phase = 'setup';
        this._emit();
        break;
      }
      case 'new_round': {
        freshRound(this.state);
        this.state.roundNumber = payload.roundNumber;
        this.state.phase = 'setup';
        this._emit();
        break;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/game.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game.js test/game.test.js
git commit -m "feat: Game — play again and new round"
```

---

## Task 8: `Game` — reconnection: `resync`, `state_snapshot`, `round_lost`

**Files:**
- Modify: `src/game.js`
- Test: `test/game.test.js` (append)

**Interfaces:**
- Consumes: Task 7 `Game`.
- Produces:
  - `game.snapshot(): object` — public-safe: `{ phase, preset, min, max, roundNumber, guesses (deep-copied), revealedMessage, totalGuesses }`. **Never** `secret` or `revealMessage`.
  - `game.resync(): Array<{type,payload}>` — returns `[{ type: 'resync', payload: {} }]`. Called by `main` on peer reconnect.
  - `receive` `resync`: if our role is known, returns `[{ type: 'hello', payload: { role } }]` and, if `phase !== 'lobby'`, also `{ type: 'state_snapshot', payload: this.snapshot() }`.
  - `receive` `state_snapshot`: the rejoining client rebuilds its view. **If** `role === 'setter'` **and** `secret === null` **and** `payload.phase === 'playing'` → `phase → 'round_lost'` and return `[{ type: 'round_lost', payload: {} }]`. Otherwise adopt `phase`/`preset`/`min`/`max`/`roundNumber`/`guesses`/`revealedMessage`/`totalGuesses` from the payload.
  - `receive` `round_lost`: both — `phase → 'round_lost'`.
  - `receive` `partner_left` (synthetic, sent by `main` from presence): `partnerPresent = false`.
  - `receive` `partner_here` (synthetic, sent by `main` from presence): `partnerPresent = true`.

- [ ] **Step 1: Write the failing tests (append)**

```js
describe('snapshot', () => {
  it('never contains the secret or the pre-win message', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    g.state.revealMessage = 'secret note';
    g.state.min = 1; g.state.max = 100; g.state.preset = 'medium';
    const snap = g.snapshot();
    expect(JSON.stringify(snap)).not.toContain('42');
    expect(JSON.stringify(snap)).not.toContain('secret note');
    expect(snap.phase).toBe('playing');
    expect(snap.min).toBe(1);
  });
});

describe('reconnection', () => {
  it('resync responder returns hello + snapshot when mid-game', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    g.state.min = 1; g.state.max = 100;
    const res = g.receive({ type: 'resync', payload: {}, from: 'x' });
    expect(outbound(res, 'hello')).toBeTruthy();
    expect(outbound(res, 'state_snapshot')).toBeTruthy();
  });

  it('a refreshed setter (no secret) mid-playing declares the round lost', () => {
    const g = new Game({ role: null });
    g.receive({ type: 'hello', payload: { role: 'guesser' }, from: 'x' }); // role -> setter
    const res = g.receive({
      type: 'state_snapshot',
      payload: { phase: 'playing', preset: 'medium', min: 1, max: 100, roundNumber: 1, guesses: [{ n: 1, value: 5, hint: 'higher' }], revealedMessage: null, totalGuesses: null },
      from: 'x',
    });
    expect(g.state.phase).toBe('round_lost');
    expect(outbound(res, 'round_lost')).toBeTruthy();
  });

  it('a refreshed guesser mid-playing resumes with the guess history', () => {
    const g = new Game({ role: null });
    g.receive({ type: 'hello', payload: { role: 'setter' }, from: 'x' }); // role -> guesser
    g.receive({
      type: 'state_snapshot',
      payload: { phase: 'playing', preset: 'medium', min: 1, max: 100, roundNumber: 1, guesses: [{ n: 1, value: 5, hint: 'higher' }], revealedMessage: null, totalGuesses: null },
      from: 'x',
    });
    expect(g.state.phase).toBe('playing');
    expect(g.state.guesses).toEqual([{ n: 1, value: 5, hint: 'higher' }]);
  });

  it('an established setter with its secret intact ignores the round_lost path', () => {
    const g = new Game({ role: 'setter' });
    g.state.phase = 'playing';
    g.state.secret = 42;
    const res = g.receive({
      type: 'state_snapshot',
      payload: { phase: 'playing', preset: 'medium', min: 1, max: 100, roundNumber: 1, guesses: [{ n: 1, value: 5, hint: null }], revealedMessage: null, totalGuesses: null },
      from: 'x',
    });
    expect(g.state.phase).toBe('playing');
    expect(outbound(res, 'round_lost')).toBeFalsy();
  });

  it('round_lost message moves either side to the round_lost screen', () => {
    const g = new Game({ role: 'guesser' });
    g.state.phase = 'playing';
    g.receive({ type: 'round_lost', payload: {}, from: 'x' });
    expect(g.state.phase).toBe('round_lost');
  });

  it('synthetic presence messages toggle partnerPresent', () => {
    const g = new Game({ role: 'setter' });
    g.receive({ type: 'partner_here', payload: {}, from: 'local' });
    expect(g.state.partnerPresent).toBe(true);
    g.receive({ type: 'partner_left', payload: {}, from: 'local' });
    expect(g.state.partnerPresent).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/game.test.js`
Expected: FAIL — `g.snapshot is not a function`.

- [ ] **Step 3: Implement in `src/game.js`**

Add to `Game`:

```js
  snapshot() {
    return {
      phase: this.state.phase,
      preset: this.state.preset,
      min: this.state.min,
      max: this.state.max,
      roundNumber: this.state.roundNumber,
      guesses: this.state.guesses.map((g) => ({ ...g })),
      revealedMessage: this.state.revealedMessage,
      totalGuesses: this.state.totalGuesses,
    };
  }

  resync() {
    return [{ type: 'resync', payload: {} }];
  }
```

Add `case`s to `receive`:

```js
      case 'resync': {
        if (this.state.role) {
          out.push({ type: 'hello', payload: { role: this.state.role } });
          if (this.state.phase !== 'lobby') {
            out.push({ type: 'state_snapshot', payload: this.snapshot() });
          }
        }
        break;
      }
      case 'state_snapshot': {
        const s = payload;
        if (this.state.role === 'setter' && this.state.secret === null && s.phase === 'playing') {
          this.state.phase = 'round_lost';
          out.push({ type: 'round_lost', payload: {} });
        } else {
          this.state.phase = s.phase;
          this.state.preset = s.preset;
          this.state.min = s.min;
          this.state.max = s.max;
          this.state.roundNumber = s.roundNumber;
          this.state.guesses = s.guesses.map((g) => ({ ...g }));
          this.state.revealedMessage = s.revealedMessage;
          this.state.totalGuesses = s.totalGuesses;
        }
        this._emit();
        break;
      }
      case 'round_lost': {
        this.state.phase = 'round_lost';
        this._emit();
        break;
      }
      case 'partner_here': {
        this.state.partnerPresent = true;
        this._emit();
        break;
      }
      case 'partner_left': {
        this.state.partnerPresent = false;
        this._emit();
        break;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/game.test.js`
Expected: PASS. Also run the full file: `npx vitest run test/game.test.js` — all prior tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/game.js test/game.test.js
git commit -m "feat: Game — reconnection, snapshot, round lost"
```

---

## Task 9: In-memory fake realtime pair (test double)

**Files:**
- Create: `test/fake-realtime.js`
- Test: `test/fake-realtime.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createFakeRealtimePair(): [RealtimeLike, RealtimeLike]` — two clients sharing one in-memory bus.
  - `RealtimeLike` shape (the same surface `createRealtime()` exposes in Task 10):
    - `clientId: string`
    - `connect(): Promise<void>` — resolves immediately for the fake.
    - `send(type: string, payload: object): void` — delivers `{ type, payload, from: this.clientId }` to the **other** client's `type` handlers on a microtask.
    - `on(type: string, handler: (payload, from) => void): void`
    - `onPresence(event: 'enter'|'leave', handler: () => void): void`
    - `enter(): void` — fires the other client's `'enter'` handlers on a microtask.
    - `leave(): void` — fires the other client's `'leave'` handlers on a microtask.
    - `close(): void`
  - Delivery is asynchronous via `queueMicrotask` so tests `await Promise.resolve()` (or a tiny helper) to flush.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest';
import { createFakeRealtimePair } from './fake-realtime.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createFakeRealtimePair', () => {
  it('delivers a message from A to B with from = A.clientId', async () => {
    const [a, b] = createFakeRealtimePair();
    const received = [];
    b.on('ping', (payload, from) => received.push({ payload, from }));
    a.send('ping', { n: 1 });
    await flush();
    expect(received).toEqual([{ payload: { n: 1 }, from: a.clientId }]);
  });

  it('does not deliver a message back to the sender', async () => {
    const [a, b] = createFakeRealtimePair();
    let got = 0;
    a.on('ping', () => { got++; });
    a.send('ping', {});
    await flush();
    expect(got).toBe(0);
  });

  it('enter() fires the peer enter handler', async () => {
    const [a, b] = createFakeRealtimePair();
    let entered = 0;
    b.onPresence('enter', () => { entered++; });
    a.enter();
    await flush();
    expect(entered).toBe(1);
  });

  it('leave() fires the peer leave handler', async () => {
    const [a, b] = createFakeRealtimePair();
    let left = 0;
    b.onPresence('leave', () => { left++; });
    a.leave();
    await flush();
    expect(left).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/fake-realtime.test.js`
Expected: FAIL — cannot resolve `./fake-realtime.js`.

- [ ] **Step 3: Write `test/fake-realtime.js`**

```js
class FakeRealtime {
  constructor(clientId) {
    this.clientId = clientId;
    this._peer = null;
    this._handlers = new Map();        // type -> Set<fn>
    this._presence = { enter: new Set(), leave: new Set() };
  }

  async connect() {}

  send(type, payload) {
    const peer = this._peer;
    if (!peer) return;
    queueMicrotask(() => {
      const set = peer._handlers.get(type);
      if (set) for (const fn of set) fn(payload, this.clientId);
    });
  }

  on(type, handler) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(handler);
  }

  onPresence(event, handler) {
    this._presence[event].add(handler);
  }

  enter() {
    const peer = this._peer;
    if (!peer) return;
    queueMicrotask(() => {
      for (const fn of peer._presence.enter) fn();
    });
  }

  leave() {
    const peer = this._peer;
    if (!peer) return;
    queueMicrotask(() => {
      for (const fn of peer._presence.leave) fn();
    });
  }

  close() {
    this._handlers.clear();
    this._presence.enter.clear();
    this._presence.leave.clear();
  }
}

export function createFakeRealtimePair() {
  const a = new FakeRealtime('client-a');
  const b = new FakeRealtime('client-b');
  a._peer = b;
  b._peer = a;
  return [a, b];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/fake-realtime.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/fake-realtime.js test/fake-realtime.test.js
git commit -m "test: in-memory fake realtime pair"
```

---

## Task 10: `createRealtime()` — Ably wrapper

**Files:**
- Create: `src/realtime.js`
- Test: `test/realtime.test.js`

**Interfaces:**
- Consumes: `ably` (injected in tests via the `AblyRealtime` option).
- Produces:
  - `createRealtime({ roomCode: string, tokenUrl?: string, AblyRealtime?: constructor }): RealtimeLike` — `tokenUrl` defaults to `'/api/ably-token'`; `AblyRealtime` defaults to `Ably.Realtime` from the `ably` package.
  - Same `RealtimeLike` surface as Task 9, plus:
    - `connect()` — constructs the Ably client with `authUrl: tokenUrl`, gets the channel named `roomCode`, attaches, enters presence with an empty data object, resolves when attached.
    - `send(type, payload)` — `channel.publish(type, { ...payload, from: this.clientId })`. (Type is the Ably message `name`.)
    - `on(type, handler)` — `channel.subscribe(type, (msg) => handler(msg.data, msg.data.from))`.
    - `onPresence('enter'|'leave', handler)` — `channel.presence.subscribe(event, () => handler())`.
    - `close()` — `channel.presence.leave()` then `client.close()`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi } from 'vitest';
import { createRealtime } from '../src/realtime.js';

function makeAblyStub() {
  const channel = {
    publish: vi.fn(),
    subscribe: vi.fn(),
    attach: vi.fn().mockResolvedValue(undefined),
    presence: {
      enter: vi.fn().mockResolvedValue(undefined),
      leave: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
    },
  };
  const client = {
    channels: { get: vi.fn().mockReturnValue(channel) },
    close: vi.fn(),
  };
  const ctor = vi.fn().mockImplementation(() => client);
  return { ctor, client, channel };
}

describe('createRealtime', () => {
  it('connects to the channel named after the room code and enters presence', async () => {
    const { ctor, client, channel } = makeAblyStub();
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ authUrl: '/api/ably-token' }));
    expect(client.channels.get).toHaveBeenCalledWith('ABCDE');
    expect(channel.attach).toHaveBeenCalled();
    expect(channel.presence.enter).toHaveBeenCalled();
  });

  it('send() publishes with type as name and from in the data', async () => {
    const { ctor, channel } = makeAblyStub();
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    rt.send('guess', { value: 7 });
    expect(channel.publish).toHaveBeenCalledWith('guess', expect.objectContaining({ value: 7, from: rt.clientId }));
  });

  it('on() subscribes and unwraps msg.data', async () => {
    const { ctor, channel } = makeAblyStub();
    let handlerArg;
    channel.subscribe.mockImplementation((name, cb) => { if (name === 'guess') handlerArg = cb; });
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    const seen = [];
    rt.on('guess', (payload, from) => seen.push({ payload, from }));
    handlerArg({ data: { value: 7, from: 'peer' } });
    expect(seen).toEqual([{ payload: { value: 7, from: 'peer' }, from: 'peer' }]);
  });

  it('onPresence maps enter/leave', async () => {
    const { ctor, channel } = makeAblyStub();
    const rt = createRealtime({ roomCode: 'ABCDE', AblyRealtime: ctor });
    await rt.connect();
    rt.onPresence('enter', () => {});
    expect(channel.presence.subscribe).toHaveBeenCalledWith('enter', expect.any(Function));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/realtime.test.js`
Expected: FAIL — cannot resolve `../src/realtime.js`.

- [ ] **Step 3: Write `src/realtime.js`**

```js
import * as Ably from 'ably';

function randomId() {
  return 'c-' + Math.random().toString(36).slice(2, 10);
}

export function createRealtime({ roomCode, tokenUrl = '/api/ably-token', AblyRealtime } = {}) {
  const Ctor = AblyRealtime || Ably.Realtime;
  const clientId = randomId();
  let client = null;
  let channel = null;

  return {
    clientId,

    async connect() {
      client = new Ctor({ authUrl: tokenUrl, clientId });
      channel = client.channels.get(roomCode);
      await channel.attach();
      await channel.presence.enter({});
    },

    send(type, payload) {
      channel.publish(type, { ...payload, from: clientId });
    },

    on(type, handler) {
      channel.subscribe(type, (msg) => handler(msg.data, msg.data && msg.data.from));
    },

    onPresence(event, handler) {
      channel.presence.subscribe(event, () => handler());
    },

    async close() {
      try {
        if (channel) await channel.presence.leave();
      } finally {
        if (client) client.close();
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/realtime.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/realtime.js test/realtime.test.js
git commit -m "feat: Ably realtime wrapper"
```

---

## Task 11: Integration test — full round through the fake realtime

**Files:**
- Create: `test/integration.test.js`
- Create: `test/drive.js` (shared helper that wires a `Game` to a `RealtimeLike`)

**Interfaces:**
- Consumes: `src/game.js`, `test/fake-realtime.js`.
- Produces:
  - `wire(game, rt): void` — subscribes `rt` to every message type the game understands, routing each into `game.receive(...)` and publishing any returned outbound messages back through `rt.send(...)`; also maps `rt` presence `enter` → send `game.hello()` (+ `game.resync()` if `phase !== 'lobby'`) and `leave` → `game.receive({ type: 'partner_left', payload: {} })`.

  This is the same wiring `src/main.js` will use (Task 14); keeping it in a shared helper keeps the integration test honest.

- [ ] **Step 1: Write `test/drive.js`**

```js
const WIRE_TYPES = [
  'hello', 'round_start', 'guess', 'hint', 'reveal',
  'play_again', 'new_round', 'resync', 'state_snapshot', 'round_lost',
];

export function wire(game, rt) {
  const publish = (msgs) => {
    for (const m of msgs || []) rt.send(m.type, m.payload);
  };

  for (const type of WIRE_TYPES) {
    rt.on(type, (payload, from) => {
      publish(game.receive({ type, payload, from }));
    });
  }

  rt.onPresence('enter', () => {
    publish(game.hello());
    if (game.state.phase !== 'lobby') publish(game.resync());
  });

  rt.onPresence('leave', () => {
    game.receive({ type: 'partner_left', payload: {} });
  });
}
```

- [ ] **Step 2: Write the failing integration test**

```js
import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { createFakeRealtimePair } from './fake-realtime.js';
import { wire } from './drive.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('full round', () => {
  it('plays a round, reveals the message, and swaps roles on play again', async () => {
    const [rtSetter, rtGuesser] = createFakeRealtimePair();
    const setter = new Game({ role: 'setter' });
    const guesser = new Game({ role: 'guesser' });
    wire(setter, rtSetter);
    wire(guesser, rtGuesser);

    // handshake
    rtSetter.send('hello', { role: 'setter' });
    rtGuesser.send('hello', { role: 'guesser' });
    await flush();
    expect(setter.state.phase).toBe('setup');
    expect(guesser.state.phase).toBe('setup');

    // setter starts a medium round, secret 42
    rtSetter.send('round_start', setter.startRound({ preset: 'medium', secret: 42, message: 'kiss' })[0].payload);
    await flush();
    expect(guesser.state.phase).toBe('playing');
    expect(guesser.state.max).toBe(100);

    // guesser: 50 (too high), 25 (too low), 42 (correct)
    rtGuesser.send('guess', guesser.submitGuess(50)[0].payload);
    await flush();
    rtSetter.send('hint', setter.sendHint('lower')[0].payload);
    await flush();
    expect(guesser.state.guesses[0].hint).toBe('lower');

    rtGuesser.send('guess', guesser.submitGuess(25)[0].payload);
    await flush();
    rtSetter.send('hint', setter.sendHint('higher')[0].payload);
    await flush();

    rtGuesser.send('guess', guesser.submitGuess(42)[0].payload);
    await flush();
    expect(setter.state.canConfirmWin).toBe(true);

    rtSetter.send('reveal', setter.confirmWin()[0].payload);
    await flush();
    expect(guesser.state.phase).toBe('finished');
    expect(guesser.state.revealedMessage).toBe('kiss');
    expect(guesser.state.totalGuesses).toBe(3);
    expect(setter.state.totalGuesses).toBe(3);

    // play again -> roles swap
    rtSetter.send('play_again', setter.playAgain()[0].payload);
    await flush();
    expect(setter.state.role).toBe('guesser');
    expect(guesser.state.role).toBe('setter');
    expect(setter.state.phase).toBe('setup');
    expect(guesser.state.phase).toBe('setup');
    expect(guesser.state.roundNumber).toBe(2);
  });
});
```

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `npx vitest run test/integration.test.js`
Expected: initially FAIL if `drive.js` has a bug; iterate until PASS. Then run the whole suite: `npm test` — all green.

- [ ] **Step 4: Commit**

```bash
git add test/integration.test.js test/drive.js
git commit -m "test: full-round integration through fake realtime"
```

---

## Task 12: Serverless Ably token endpoint

**Files:**
- Create: `api/ably-token.js`
- Create: `vercel.json`
- Test: `test/ably-token.test.js`

**Interfaces:**
- Consumes: `ably` (injected in the test).
- Produces:
  - `export default async function handler(req, res)` — Vercel Node function. Builds `new Ably.Rest(process.env.ABLY_API_KEY)`, calls `createTokenRequest()`, responds `200` with the token request JSON. On missing key or error, responds `500` with `{ error }`.
  - For testability, factor the core into `export async function makeTokenRequest(AblyRest = Ably.Rest, apiKey = process.env.ABLY_API_KEY)` and have `handler` call it.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi } from 'vitest';
import { makeTokenRequest } from '../api/ably-token.js';

describe('makeTokenRequest', () => {
  it('creates a token request using the API key', async () => {
    const createTokenRequest = vi.fn().mockResolvedValue({ keyName: 'k', nonce: 'n' });
    const AblyRest = vi.fn().mockImplementation(() => ({ auth: { createTokenRequest } }));
    const out = await makeTokenRequest(AblyRest, 'app.key:secret');
    expect(AblyRest).toHaveBeenCalledWith('app.key:secret');
    expect(out).toEqual({ keyName: 'k', nonce: 'n' });
  });

  it('throws when the API key is missing', async () => {
    const AblyRest = vi.fn();
    await expect(makeTokenRequest(AblyRest, undefined)).rejects.toThrow(/ABLY_API_KEY/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ably-token.test.js`
Expected: FAIL — cannot resolve `../api/ably-token.js`.

- [ ] **Step 3: Write `api/ably-token.js`**

```js
import * as Ably from 'ably';

export async function makeTokenRequest(AblyRest = Ably.Rest, apiKey = process.env.ABLY_API_KEY) {
  if (!apiKey) throw new Error('ABLY_API_KEY is not set');
  const rest = new AblyRest(apiKey);
  return rest.auth.createTokenRequest({});
}

export default async function handler(req, res) {
  try {
    const tokenRequest = await makeTokenRequest();
    res.status(200).json(tokenRequest);
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
```

- [ ] **Step 4: Write `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "vite build",
  "outputDirectory": "dist"
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/ably-token.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/ably-token.js vercel.json test/ably-token.test.js
git commit -m "feat: serverless Ably token endpoint"
```

---

## Task 13: UI rendering

**Files:**
- Create: `src/ui.js`
- Rewrite: `src/style.css`
- Test: none (manual smoke only — see README task). Keep `ui.js` free of game logic so there is nothing to unit-test.

**Interfaces:**
- Consumes: `src/presets.js` (for preset labels/ranges on the setup screen).
- Produces:
  - `render(container: HTMLElement, state, actions): void` — clears `container` and rebuilds it for `state.phase` / `state.role`. Idempotent: safe to call on every `onChange`.
  - `actions` object (all optional functions; `render` wires them to buttons/inputs):
    - `createGame()` — home screen "Create game".
    - `joinGame(code: string)` — home screen "Join".
    - `startRound({ preset, secret, message })` — setup screen (setter).
    - `submitGuess(value: number)` — playing screen (guesser).
    - `sendHint('higher'|'lower')` — playing screen (setter).
    - `confirmWin()` — playing screen (setter, when `state.canConfirmWin`).
    - `playAgain()` — finished screen.
    - `newRound()` — round_lost screen.
    - `copyCode()` — lobby screen copy button.

- [ ] **Step 1: Write `src/ui.js`**

```js
import { PRESETS } from './presets.js';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c) node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

function banner(state) {
  if (state.phase !== 'lobby' && state.partnerPresent === false) {
    return el('div', { class: 'banner', text: 'Partner disconnected — waiting for them to come back…' });
  }
  return null;
}

function screenHome(actions) {
  const codeInput = el('input', { class: 'code-input', maxlength: '5', placeholder: 'CODE', autocapitalize: 'characters' });
  return el('div', { class: 'screen' }, [
    el('h1', { class: 'title', text: 'Guess What' }),
    el('p', { class: 'tagline', text: 'A tiny number game for two.' }),
    el('button', { class: 'primary', onclick: () => actions.createGame() }, 'Create game'),
    el('div', { class: 'divider', text: 'or' }),
    el('form', {
      class: 'join-row',
      onsubmit: (e) => { e.preventDefault(); actions.joinGame(codeInput.value.trim().toUpperCase()); },
    }, [codeInput, el('button', { class: 'secondary', type: 'submit' }, 'Join')]),
  ]);
}

function screenLobby(state, actions) {
  return el('div', { class: 'screen' }, [
    el('h2', { text: 'Your room code' }),
    el('div', { class: 'roomcode', text: state.roomCode || '' }),
    el('button', { class: 'secondary', onclick: () => actions.copyCode() }, 'Copy code'),
    el('p', { class: 'muted', text: 'Send it to your partner. Waiting for them to join…' }),
    el('div', { class: 'spinner' }),
  ]);
}

function screenSetup(state, actions) {
  if (state.role !== 'setter') {
    return el('div', { class: 'screen' }, [
      el('h2', { text: 'Get ready' }),
      el('p', { class: 'muted', text: 'Your partner is picking a number…' }),
      el('div', { class: 'spinner' }),
    ]);
  }
  let preset = 'medium';
  const numberInput = el('input', { class: 'number-input', type: 'number', inputmode: 'numeric' });
  const messageInput = el('textarea', { class: 'message-input', maxlength: '280', placeholder: 'A hidden message they see only when they win…' });
  const error = el('p', { class: 'error' });

  const presetRow = el('div', { class: 'preset-row' },
    Object.entries(PRESETS).map(([key, p]) =>
      el('button', {
        class: 'preset' + (key === preset ? ' selected' : ''),
        type: 'button',
        onclick: (e) => {
          preset = key;
          presetRow.querySelectorAll('.preset').forEach((b) => b.classList.remove('selected'));
          e.currentTarget.classList.add('selected');
          numberInput.setAttribute('min', String(p.min));
          numberInput.setAttribute('max', String(p.max));
        },
      }, `${p.label} (${p.min}–${p.max})`),
    ),
  );

  const form = el('form', {
    class: 'screen',
    onsubmit: (e) => {
      e.preventDefault();
      const p = PRESETS[preset];
      const secret = Number(numberInput.value);
      if (!Number.isInteger(secret) || secret < p.min || secret > p.max) {
        error.textContent = `Pick a whole number between ${p.min} and ${p.max}.`;
        return;
      }
      if (!messageInput.value.trim()) {
        error.textContent = 'Add a hidden message.';
        return;
      }
      actions.startRound({ preset, secret, message: messageInput.value.trim() });
    },
  }, [
    el('h2', { text: `Round ${state.roundNumber} — you're the setter` }),
    el('label', { class: 'label', text: 'Difficulty' }),
    presetRow,
    el('label', { class: 'label', text: 'Secret number' }),
    numberInput,
    el('label', { class: 'label', text: 'Hidden message' }),
    messageInput,
    error,
    el('button', { class: 'primary', type: 'submit' }, 'Start round'),
  ]);
  return form;
}

function guessList(state) {
  return el('ul', { class: 'guesses' },
    [...state.guesses].reverse().map((g) =>
      el('li', { class: 'guess' }, [
        el('span', { class: 'guess-value', text: String(g.value) }),
        el('span', {
          class: 'hint hint-' + (g.hint || 'pending'),
          text: g.hint === 'higher' ? '↑ higher' : g.hint === 'lower' ? '↓ lower' : '…',
        }),
      ]),
    ),
  );
}

function screenPlayingGuesser(state, actions) {
  const input = el('input', { class: 'number-input', type: 'number', inputmode: 'numeric', min: String(state.min), max: String(state.max) });
  return el('div', { class: 'screen' }, [
    el('h2', { text: `Guess a number between ${state.min} and ${state.max}` }),
    el('form', {
      class: 'guess-row',
      onsubmit: (e) => { e.preventDefault(); const v = Number(input.value); if (Number.isInteger(v)) { actions.submitGuess(v); input.value = ''; } },
    }, [input, el('button', { class: 'primary', type: 'submit' }, 'Guess')]),
    guessList(state),
  ]);
}

function screenPlayingSetter(state, actions) {
  const controls = state.canConfirmWin
    ? [el('button', { class: 'primary win', onclick: () => actions.confirmWin() }, '🎉 They got it!')]
    : [
        el('button', { class: 'arrow up', onclick: () => actions.sendHint('higher') }, '↑ Higher'),
        el('button', { class: 'arrow down', onclick: () => actions.sendHint('lower') }, '↓ Lower'),
      ];
  return el('div', { class: 'screen' }, [
    el('div', { class: 'secret-pill', text: `Secret: ${state.secret}` }),
    el('h2', { text: 'Their guesses' }),
    guessList(state),
    el('div', { class: 'arrow-row' }, controls),
  ]);
}

function screenFinished(state, actions) {
  return el('div', { class: 'screen celebrate' }, [
    el('div', { class: 'confetti' }),
    el('h2', { text: `Got it in ${state.totalGuesses} guess${state.totalGuesses === 1 ? '' : 'es'}!` }),
    el('div', { class: 'reveal-card', text: state.revealedMessage || '' }),
    el('button', { class: 'primary', onclick: () => actions.playAgain() }, 'Play again'),
  ]);
}

function screenRoundLost(state, actions) {
  return el('div', { class: 'screen' }, [
    el('h2', { text: 'Round lost' }),
    el('p', { class: 'muted', text: "The setter's page was reloaded, so the secret number is gone." }),
    el('button', { class: 'primary', onclick: () => actions.newRound() }, 'New round'),
  ]);
}

export function render(container, state, actions) {
  container.textContent = '';
  const b = banner(state);
  if (b) container.append(b);

  let screen;
  switch (state.phase) {
    case 'lobby':
      screen = state.roomCode ? screenLobby(state, actions) : screenHome(actions);
      break;
    case 'setup':
      screen = screenSetup(state, actions);
      break;
    case 'playing':
      screen = state.role === 'setter' ? screenPlayingSetter(state, actions) : screenPlayingGuesser(state, actions);
      break;
    case 'finished':
      screen = screenFinished(state, actions);
      break;
    case 'round_lost':
      screen = screenRoundLost(state, actions);
      break;
    default:
      screen = screenHome(actions);
  }
  container.append(screen);
}
```

Note: `render` reads `state.roomCode`, which `main.js` (Task 14) sets on the state object after construction. Add nothing to `Game` for it.

- [ ] **Step 2: Rewrite `src/style.css`**

Mobile-first, warm palette. Use this as the baseline (tweak values with the `frontend-design` skill during this task, but keep the class names above):

```css
:root {
  --bg: #fff7f3;
  --ink: #2b2431;
  --muted: #8a7f8f;
  --accent: #e8607d;
  --accent-ink: #fff;
  --card: #ffffff;
  --up: #2fa36b;
  --down: #d1495b;
  --radius: 16px;
  color-scheme: light;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
#app { max-width: 460px; margin: 0 auto; padding: 24px 18px calc(24px + env(safe-area-inset-bottom)); }
.screen { display: flex; flex-direction: column; gap: 16px; }
.title { font-size: 2rem; margin: 8px 0 0; }
.tagline, .muted, .label { color: var(--muted); }
.label { font-size: .85rem; text-transform: uppercase; letter-spacing: .06em; margin-bottom: -8px; }
button { font: inherit; border: 0; border-radius: var(--radius); padding: 14px 18px; cursor: pointer; }
.primary { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
.secondary { background: var(--card); color: var(--ink); border: 1px solid #eadfe4; }
.divider { text-align: center; color: var(--muted); }
.join-row, .guess-row { display: flex; gap: 8px; }
.join-row input, .guess-row input, .number-input, .message-input, .code-input {
  flex: 1; font: inherit; padding: 14px; border-radius: var(--radius); border: 1px solid #eadfe4; background: var(--card); width: 100%;
}
.message-input { min-height: 84px; resize: vertical; }
.code-input { text-transform: uppercase; letter-spacing: .3em; text-align: center; }
.roomcode { font-size: 2.4rem; font-weight: 700; letter-spacing: .35em; text-align: center; background: var(--card); border-radius: var(--radius); padding: 18px; border: 1px dashed var(--accent); }
.preset-row { display: flex; flex-direction: column; gap: 8px; }
.preset { background: var(--card); border: 1px solid #eadfe4; text-align: left; }
.preset.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; }
.guesses { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.guess { display: flex; justify-content: space-between; align-items: center; background: var(--card); border-radius: 12px; padding: 10px 14px; }
.guess-value { font-weight: 700; font-size: 1.1rem; }
.hint-higher { color: var(--up); }
.hint-lower { color: var(--down); }
.hint-pending { color: var(--muted); }
.arrow-row { display: flex; flex-direction: column; gap: 10px; }
.arrow { font-size: 1.2rem; font-weight: 700; padding: 20px; }
.arrow.up { background: #e7f6ee; color: var(--up); }
.arrow.down { background: #fdeaed; color: var(--down); }
.win { font-size: 1.15rem; padding: 20px; }
.secret-pill { align-self: flex-start; background: var(--ink); color: #fff; border-radius: 999px; padding: 6px 14px; font-weight: 700; }
.reveal-card { background: var(--card); border-radius: var(--radius); padding: 20px; font-size: 1.15rem; border: 1px solid #eadfe4; white-space: pre-wrap; }
.banner { background: #fff3cd; color: #7a5b00; border-radius: 12px; padding: 10px 14px; margin-bottom: 14px; font-size: .9rem; }
.error { color: var(--down); min-height: 1.2em; margin: 0; }
.spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid #eadfe4; border-top-color: var(--accent); animation: spin 1s linear infinite; align-self: center; }
@keyframes spin { to { transform: rotate(360deg); } }
.celebrate .confetti::before { content: "🎉"; font-size: 3rem; display: block; text-align: center; animation: pop .5s ease-out; }
@keyframes pop { from { transform: scale(.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
```

- [ ] **Step 3: Manual check**

Run: `npm run dev`, open the URL. You will see the Home screen (Create / Join). Deeper screens need wiring from Task 14 — just confirm Home renders and has no console errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui.js src/style.css
git commit -m "feat: UI rendering for all screens"
```

---

## Task 14: Bootstrap and wiring (`main.js`)

**Files:**
- Rewrite: `src/main.js`

**Interfaces:**
- Consumes: `src/game.js`, `src/realtime.js`, `src/ui.js`, `src/roomcode.js`.
- Produces: the running app. No exports.

Behavior:
- On load: read `location.hash` (strip `#`). If it is a valid room code, auto-join as an **unknown-role** client (`new Game({ role: null })`, `state.roomCode = code`, connect, `phase` stays `lobby` until handshake). Otherwise render Home.
- `createGame()`: `code = generateRoomCode()`, `game = new Game({ role: 'setter' })`, `game.state.roomCode = code`, `location.hash = code`, connect, `render`.
- `joinGame(code)`: validate; `game = new Game({ role: 'guesser' })`, `state.roomCode = code`, `location.hash = code`, connect, `render`.
- After connect: `wire(game, rt)` (same helper shape as `test/drive.js` — copy it into `main.js` or import from a shared `src/wire.js`; see Step 1), then `rt.send` each message from `game.hello()`.
- `game.onChange(() => render(app, game.state, actions))`.
- Presence `enter`: `game.receive({ type: 'partner_here', payload: {} })`, then send `game.hello()`, and if `game.state.phase !== 'lobby'` also send `game.resync()`.
- Presence `leave`: `game.receive({ type: 'partner_left', payload: {} })`.
- Connection failure (any throw from `rt.connect()`): render a full-screen "Can't connect" with a "Retry" button that reloads.

- [ ] **Step 1: Extract shared wiring to `src/wire.js`**

Move the `wire` function so both `main.js` and the integration test use one copy. Create `src/wire.js`:

```js
const WIRE_TYPES = [
  'hello', 'round_start', 'guess', 'hint', 'reveal',
  'play_again', 'new_round', 'resync', 'state_snapshot', 'round_lost',
];

export function wire(game, rt) {
  const publish = (msgs) => {
    for (const m of msgs || []) rt.send(m.type, m.payload);
  };
  for (const type of WIRE_TYPES) {
    rt.on(type, (payload, from) => publish(game.receive({ type, payload, from })));
  }
  rt.onPresence('enter', () => {
    game.receive({ type: 'partner_here', payload: {} });
    publish(game.hello());
    if (game.state.phase !== 'lobby') publish(game.resync());
  });
  rt.onPresence('leave', () => {
    game.receive({ type: 'partner_left', payload: {} });
  });
}
```

Then update `test/drive.js` to just re-export: `export { wire } from '../src/wire.js';` and re-run `npx vitest run test/integration.test.js` (expected: still PASS).

- [ ] **Step 2: Write `src/main.js`**

```js
import { Game } from './game.js';
import { createRealtime } from './realtime.js';
import { render } from './ui.js';
import { wire } from './wire.js';
import { isValidRoomCode, generateRoomCode } from './roomcode.js';

const app = document.getElementById('app');
let game = null;
let rt = null;

const actions = {
  createGame: () => start(generateRoomCode(), 'setter'),
  joinGame: (code) => { if (isValidRoomCode(code)) start(code, 'guesser'); },
  startRound: (args) => send(game.startRound(args)),
  submitGuess: (v) => send(game.submitGuess(v)),
  sendHint: (d) => send(game.sendHint(d)),
  confirmWin: () => send(game.confirmWin()),
  playAgain: () => send(game.playAgain()),
  newRound: () => send(game.newRound()),
  copyCode: () => navigator.clipboard && navigator.clipboard.writeText(game.state.roomCode),
};

function send(msgs) {
  for (const m of msgs || []) rt.send(m.type, m.payload);
}

function paint() {
  render(app, game.state, actions);
}

function fatal(message) {
  app.textContent = '';
  const box = document.createElement('div');
  box.className = 'screen';
  box.innerHTML = `<h2>Can't connect</h2><p class="muted">${message}</p>`;
  const retry = document.createElement('button');
  retry.className = 'primary';
  retry.textContent = 'Retry';
  retry.onclick = () => location.reload();
  box.append(retry);
  app.append(box);
}

async function start(code, role) {
  game = new Game({ role });
  game.state.roomCode = code;
  game.onChange(paint);
  location.hash = code;
  rt = createRealtime({ roomCode: code });
  try {
    await rt.connect();
  } catch (err) {
    fatal(String(err && err.message ? err.message : err));
    return;
  }
  wire(game, rt);
  send(game.hello());
  paint();
}

async function boot() {
  const hash = location.hash.replace(/^#/, '').toUpperCase();
  if (isValidRoomCode(hash)) {
    game = new Game({ role: null });
    game.state.roomCode = hash;
    game.onChange(paint);
    rt = createRealtime({ roomCode: hash });
    try {
      await rt.connect();
    } catch (err) {
      fatal(String(err && err.message ? err.message : err));
      return;
    }
    wire(game, rt);
    send(game.hello());
    paint();
  } else {
    // Home screen: a bare Game in lobby with no roomCode renders Home.
    game = new Game({ role: null });
    game.onChange(paint);
    paint();
  }
}

boot();
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green (unit, fake, realtime, integration, token).

- [ ] **Step 4: Commit**

```bash
git add src/main.js src/wire.js test/drive.js
git commit -m "feat: bootstrap and wire Game to realtime and UI"
```

---

## Task 15: README, deploy config, manual smoke checklist

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything.
- Produces: setup + deploy docs; a manual smoke checklist an executor runs before declaring done.

- [ ] **Step 1: Write `README.md`**

````markdown
# Guess What

A real-time number-guessing game for two people. One sets a secret number and a
hidden message; the other guesses, getting "higher" / "lower" hints. The hidden
message is revealed on a correct guess. Roles swap each round.

## Local development

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # run the test suite
```

The dev server serves the frontend only. `/api/ably-token` runs on Vercel; for
full local realtime use `vercel dev` (see below) with `ABLY_API_KEY` set.

## Deploy (Vercel, free tier)

1. Create an Ably account (free) and copy an API key with `publish`,
   `subscribe`, and `presence` capabilities.
2. Import the repo into Vercel. Framework preset: **Vite**.
3. Add an environment variable: `ABLY_API_KEY = <your key>`.
4. Deploy. `api/ably-token.js` is picked up automatically as a serverless
   function.

### Local end-to-end (optional)

```bash
npm i -g vercel
ABLY_API_KEY=<your key> vercel dev
```

## How connection works

- Ably is a pub/sub relay; the room code is the channel name.
- The secret number and hidden message never leave the setter's browser tab.
- The room code is mirrored to the URL hash so a reload reconnects.
- If the **setter** reloads mid-round, the secret is gone: both players see
  "Round lost" and can start a new round.

## Manual smoke checklist

Run before declaring the app done. Use two browsers (or one normal + one
private window).

- [ ] Browser A: "Create game" → a 5-char code shows; URL has `#CODE`.
- [ ] Browser B: open the app, "Join with code", enter the code → both move to
      the setup screen; A is setter, B is guesser.
- [ ] A: pick Medium, secret `42`, message "you're my favorite", "Start round".
- [ ] B: sees "Guess a number between 1 and 100".
- [ ] B guesses `70` → A sees the guess; A taps "↓ Lower" → B's guess shows a
      red ↓ chip.
- [ ] B guesses `42` → A's controls change to "🎉 They got it!"; A taps it.
- [ ] Both: "Got it in 2 guesses!" and the message "you're my favorite" shows.
- [ ] Either: "Play again" → both return to setup with roles swapped
      (B is now setter), round number is 2.
- [ ] Disconnect test: during a round, close Browser B's tab → A shows the
      "Partner disconnected" banner. Reopen B to the same URL → banner clears
      and B rejoins the round.
- [ ] Setter-refresh test: during a round, reload Browser A → both show
      "Round lost"; "New round" returns both to setup with roles unchanged.
- [ ] Bad code: on a fresh browser, "Join with code" with a wrong 5-char code →
      stays on a waiting state, no crash.
- [ ] No errors in either browser console throughout.
````

- [ ] **Step 2: Run the full suite once more**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README, deploy steps, manual smoke checklist"
```

- [ ] **Step 4: Execute the manual smoke checklist**

Deploy to Vercel (or run `vercel dev` with `ABLY_API_KEY`) and work through
every box in the README checklist. Fix any failure before declaring the plan
complete. If a fix touches state-machine behavior, add a regression test to
`test/game.test.js` first.

---

## Self-Review

**1. Spec coverage:**

| Spec element | Task |
|---|---|
| Real-time, two players | 10, 11, 14 |
| No accounts; connect via room code | 2, 14 |
| Room code mirrored to URL hash; reconnect | 8, 14 |
| Creator = setter, joiner = guesser; roles swap each round | 3, 7 |
| Three presets (1–20 / 1–100 / 1–1000) | 3 |
| Setter picks secret + hidden text message | 4, 13 |
| Range broadcast without secret/message | 4 (test asserts) |
| Guesser guesses; guess list with ↑/↓ chips | 5, 13 |
| Setter gives manual higher/lower hints | 5, 13 |
| Auto-detect exact-match win → confirm → reveal | 5, 6 |
| Finished screen: guess count + revealed message + Play again | 6, 13 |
| Manual hints not validated for truthfulness | 5 (no validation code) |
| Partner-drop banner + resync on rejoin | 8, 13, 14 |
| Setter-refresh → "round lost" + New round | 7, 8, 13 |
| Bad room code → stays waiting | 2, 13, 15 (smoke) |
| Ably pub/sub relay, room code = channel | 10 |
| `/api/ably-token` serverless, `ABLY_API_KEY` | 12 |
| Vercel static deploy | 12, 15 |
| game.js unit tests (bulk of coverage) | 3–8 |
| fake Ably channel | 9 |
| integration test: full round + role swap | 11 |
| serverless handler test | 12 |
| README manual smoke checklist | 15 |
| Mobile-first, warm/playful visual direction | 13 |

No gaps found.

**2. Placeholder scan:** No "TBD"/"TODO"/"add error handling"-style placeholders. Every code step has real code; every test step has real assertions.

**3. Type consistency:**
- `Game` method names used identically across tasks and `src/wire.js` / `test/drive.js`: `hello()`, `receive()`, `startRound()`, `submitGuess()`, `sendHint()`, `confirmWin()`, `playAgain()`, `newRound()`, `resync()`, `snapshot()`, `onChange()`.
- `state` keys are fixed in Task 3 and only read/written by that same set of names afterward (`canConfirmWin`, `revealedMessage`, `revealMessage`, `partnerPresent`, `roomCode`).
- Message `type` strings are one set, listed in Global Constraints and `WIRE_TYPES`, matching the spec's protocol table (including `new_round`, `round_lost` added there).
- `RealtimeLike` surface (`connect`, `send`, `on`, `onPresence`, `enter`, `leave`, `close`, `clientId`) is identical between `test/fake-realtime.js` (Task 9) and `src/realtime.js` (Task 10).
- `render(container, state, actions)` — Task 13 defines it; Task 14 calls it with `game.state`. Consistent.

No inconsistencies found.
