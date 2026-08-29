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

// Tracked so an incidental presence-only change cannot blow away the setter's
// in-progress setup form (see FIX 7 / I4).
let painted = { phase: null, role: null, partnerPresent: null };

function paint() {
  const s = game.state;
  const presenceOnly =
    painted.phase === s.phase &&
    painted.role === s.role &&
    painted.partnerPresent !== s.partnerPresent;
  painted = { phase: s.phase, role: s.role, partnerPresent: s.partnerPresent };
  // While the setter is filling in the setup form, skip a re-render triggered only by
  // partner presence flipping: the connection banner lags, but their draft survives.
  if (presenceOnly && s.phase === 'setup' && s.role === 'setter') return;
  render(app, s, actions);
}

function fatal(message) {
  app.textContent = '';
  const box = document.createElement('div');
  box.className = 'screen';
  const heading = document.createElement('h2');
  heading.textContent = "Can't connect";
  const detail = document.createElement('p');
  detail.className = 'muted';
  detail.textContent = message;
  box.append(heading, detail);
  const retry = document.createElement('button');
  retry.className = 'primary';
  retry.textContent = 'Retry';
  retry.onclick = () => location.reload();
  box.append(retry);
  app.append(box);
}

async function start(code, role, { fromHash = false } = {}) {
  game = new Game({ role });
  game.state.roomCode = code;
  game.onChange(paint);
  if (!fromHash) location.hash = code;
  rt = createRealtime({ roomCode: code });
  try {
    await rt.connect();
  } catch (err) {
    fatal(String(err && err.message ? err.message : err));
    return;
  }
  wire(game, rt);
  send(game.hello());
  // Reload path only: we booted with no role and no round, so ask the peer for the
  // live state. wire()'s presence hook can't do it — a fresh client is still in lobby.
  if (role === null) send(game.resync());
  paint();
}

async function boot() {
  const hash = location.hash.replace(/^#/, '').toUpperCase();
  if (isValidRoomCode(hash)) {
    await start(hash, null, { fromHash: true });
  } else {
    // Home screen: a bare Game in lobby with no roomCode renders Home.
    game = new Game({ role: null });
    game.onChange(paint);
    paint();
  }
}

boot();
