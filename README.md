# Guess What

A real-time number-guessing game for two people. One sets a secret number and a
hidden message; the other guesses, getting "higher" / "lower" hints. The hidden
message is revealed on a correct guess. Roles swap each round. An always-visible
chat panel lets you message your partner during each round; the chat clears when
the round ends. Invite your partner with a link — the URL carries the room code,
so they join instantly with no code entry needed.

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
- [ ] Home: "Start a game" → Lobby shows "Copy invite link". Tapping it copies
      a URL ending in `#<CODE>` (or opens the share sheet on mobile).
- [ ] Open that link in the second browser → lands straight in the room, no
      Home screen, no typing.
- [ ] "or enter a code" on Home still works as a fallback.
- [ ] Chat: type a message on each side → it appears on the other side,
      right-aligned for the sender, left-aligned for the receiver.
- [ ] Type a half-finished chat message while the partner sends one → your
      draft is NOT cleared when theirs arrives.
- [ ] Start the next round → the chat panel is empty on both sides.
- [ ] Background one phone for ~2s and return → NO "partner disconnected"
      banner appears.
- [ ] Fully close one tab → the banner appears after ~3s; reopen the link →
      banner clears and the round resumes.
