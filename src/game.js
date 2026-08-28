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
      default:
        break;
    }
    return out;
  }
}
