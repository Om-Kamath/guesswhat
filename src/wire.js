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
  let presenceGen = 0;

  const onPresenceChange = async () => {
    // Serialize overlapping presence queries: only the most recently *started*
    // call may mutate prevOthers / the leave timer / emit synthetic messages.
    const gen = ++presenceGen;
    let others;
    try {
      others = (await rt.otherMembers()).length;
    } catch {
      // A failed presence.get() must not surface as an unhandledRejection; the next
      // presence event re-queries.
      return;
    }
    if (gen !== presenceGen) return;   // a newer call superseded us

    if (others > 0) {
      if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
      // Only emit on an actual transition — a redundant partner_here forces a
      // full re-render that wipes in-progress input.
      if (!game.state.partnerPresent) {
        game.receive({ type: 'partner_here', payload: {} });
      }
      if (prevOthers === 0) {
        publish(game.hello());
        // Don't double-latch _awaitingSnapshot: if both sides publish a resync,
        // neither is authoritative and the snapshot never arrives.
        if (game.state.phase !== 'lobby' && !game._awaitingSnapshot) {
          publish(game.resync());
        }
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

  // Disposer: cancel a pending grace timer so it can't fire partner_left on a
  // torn-down game if the local client goes away during the 3s window.
  return () => {
    if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
  };
}
