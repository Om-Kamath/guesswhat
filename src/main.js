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
