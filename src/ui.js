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
