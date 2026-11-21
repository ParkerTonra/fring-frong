# Fring Frong

**Terminal and desktop app.** The terminal draws the band with `Raster` cells; the Claude desktop app draws the same
show as one `Svg` of detailed 16-bit-style pixel-art frogs. The IDE extensions and mobile show nothing.

A Claude Code mod: while Claude works, two pixel-art frogs play ping pong on a small band above the prompt. The left
frog is you, the right one is Claude. The ball arcs across the table and each frog raises its arms as it hits. When
the work is done, the band goes away (between turns it takes no room at all).

- Works on macOS, Linux and Windows. It starts no processes, uses no network and reads no files.
- A match runs while your prompt's turn runs, and also while any subagent is running (background ones too), checked
  once a second. A subagent that only waits on its own background shells does not count.

## What the frogs do

- **A turn runs, or a subagent:** they rally.
- **You queue a message while Claude is busy:** both dash to the middle, bonk heads, see stars for 1.5 s, then go back
  to the rally.
- **A usage, token or rate limit:** they lie down asleep, "z Z z" floating up, the ball rolling to a stop. They stay
  asleep until the next turn starts; then one wakes with a start.
- **A tool call fails:** the ball beans a frog on the head; it flips over with dizzy stars, then gets back up.
- **A turn runs longer than 2 minutes:** the rally slows and the frogs take turns yawning.
- **A permission prompt waits on you:** both stop and turn to face you, one tapping its foot.
- **You interrupt (Esc):** the ball freezes in mid-air, both shrug, and the band leaves.
- **A turn finishes:** whoever touched the ball last scores and the winner hops. Each number sits by its frog, in the
  table's top corners: yours on the left, Claude's on the right. The score belongs to the session: it starts at 0
  for each new session and after `/clear`, and a reload of the mod keeps it.
- **The conversation is compacted:** both get squished flat, then pop back up.
- **Subagents run:** each running subagent seats one of Claude's fans on the table, a tiny frog whose eyes follow
  the ball. Fans drop in, bob in turn, cheer with star-yellow eyes when Claude's frog wins a point, and hop off when
  their agent is done (a fan the agent list stops naming leaves after 3 s). Four seats, then a dim "+N".
- **Now and then (about 1 rally in 40):** a fly buzzes past and a frog snaps at it with its tongue, missing the ball.

## How the desktop app draws it

The desktop app has no `Raster` and no `$.ui.blit`, and redrawing an `Svg` 15 times a second would send the whole
picture across each time. So the mod works out the next stretch of the show ahead of time, with the same state
machine and the same frames the terminal ticks through, and sends it as one SVG flipbook of crisp pixel rects
(`shape-rendering="crispEdges"`) shown in turn by SMIL. Each part of the band (each frog, the ball, each fan, the rest
of the table) is its own track that changes only when that part does, so a reel stays well under the `Svg` size limit.
A plain rally is one 1.6 s loop the app plays by itself; anything else (a bonk, the sleep, the hop, a fan arriving) is
the next 2 s, played once. The band redraws only when the show changes course or that stretch runs out.

On the desktop the frogs, the ball, the bonk's little frogs and the fans are the terminal's own sprites scaled up
(`hooks/sprites.ts`): every terminal pixel becomes a 2 x 2 or 3 x 3 block, with only a light polish on top (a dark
outline, one highlight and one shade on the green, a catchlight in each pupil, rounded block corners at 3x), on a
little ping pong table with a net. `DESK_SIZE` in `hooks/sprites.ts` picks the scale (3 by default), and
`DESK_STYLE = 'cells'` in `hooks/svg.ts` draws the terminal's own cells instead. The band is 252 x 48 px with the
sprites, so each sprite pixel is whole screen pixels (210 x 30 as cells). `tools/make-sprites.ts` makes
`hooks/sprites.ts` from the terminal's frogs: `deno run --allow-read --allow-write tools/make-sprites.ts`.

## Requirements

A Claude Code build that loads plugin hooks modules (function hooks: a plugin whose `hooks/hooks.json` lists
`"modules"`). The API is marked early access and may change between releases.

## Try it for one session

Clone or download this repository, then start Claude Code with it:

```
claude --plugin-dir /path/to/fring-frong
```

## Try it in the desktop app

The desktop app takes no `--plugin-dir`. Install the mod from its folder at the user scope, in a terminal:

```
claude plugin install fring-frong --marketplace /path/to/fring-frong
```

then start a new session in the desktop app's Code tab. A marketplace that is a folder is read from that folder, so
an edit there reaches a session after `/reload-plugins` (in a terminal session) or a new session. To take it out
again: `claude plugin uninstall fring-frong@fring-frong` and `claude plugin marketplace remove fring-frong`.

## Install it

Inside Claude Code:

```
/plugin marketplace add <owner>/<repo>
/plugin install fring-frong@fring-frong
```

`<owner>/<repo>` is the GitHub repository that holds this folder (its `.claude-plugin/marketplace.json` names the
marketplace `fring-frong`). Start a new session, or run `/reload-plugins`, to see it.

## Develop

- `hooks/register.tsx`: the hooks: which events drive which reaction.
- `hooks/game.ts`: the game kept for the session (the show, the score, the work running) and the mod's `$.state`.
- `hooks/match.tsx`: the band itself (`hooks/stage.ts` names it): the terminal's Rasters and blits, the desktop's
  flipbook, the animation timer.
- `hooks/show.ts`: the pure state machine, timings and pictures for every reaction.
- `hooks/pong.ts`: the pure drawing code (frog sprites, the braille table canvas, cell encoding).
- `hooks/svg.ts`: the pure desktop drawing: the sprites (or the cell grid) as pixel rects, and the SMIL flipbook.
- `hooks/sprites.ts`: the desktop's sprites, pure data with no imports, made by `tools/make-sprites.ts`.
- `claude plugin test .` runs the tests in `test/`; `claude plugin validate .` checks the manifest and hooks.

## License

MIT, see [LICENSE](LICENSE).
