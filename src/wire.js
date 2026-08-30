const WIRE_TYPES = [
  'hello', 'round_start', 'guess', 'hint', 'reveal',
  'play_again', 'new_round', 'resync', 'state_snapshot', 'round_lost', 'chat',
];

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
