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
