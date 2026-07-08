# Patch Tuesday - Game Design Document

v0.1 - owner: Craig McCart (Sonofg0tham)
Status: pre-production. Numbers are starting values, all tunable via data files.

## Pitch

It's 03:12 on a Wednesday and the on-call phone is screaming. Ransomware is loose on the network and you're the incident lead. Every turn is an hour of the incident. Isolate segments, burn your backups wisely, patch what you can reach, and decide what the board gets told. Turn-based tactics where every mechanic is real incident response tradecraft, ending in the Post-Incident Review you deserve.

## Design pillars

1. **Every turn is a trade-off.** Actions are scarce. Isolating a segment stops the spread and takes the business offline. Restoring burns a backup you might need more later. There are no free moves. Isolation is borrowed time, not a wall: leave too much of the estate cut off and business pressure builds until the business overrides IT and forces your oldest containment back online, ready or not.
2. **Visibility is a resource.** You fight what you can see, and you cannot see everywhere. EDR coverage has gaps, and the scariest node on the board is the one showing green because nothing is watching it. You can buy visibility, one node at a time, by spending an action point to deploy a sensor, so every square of the board you can see cost you a move you could not spend on containment.
3. **Every mechanic is real IR tradecraft.** Containment, eradication, recovery, the emergency change that bypasses control and haunts the review. If it wouldn't appear in a real post-incident review, it doesn't go in the game.
4. **The review is the reckoning.** Win or lose, the run ends in a Post-Incident Review generated from what actually happened. Mistakes are findings. The game is allowed to be funny about them.

## Core loop

Per turn (about 45-60 seconds of thought): read the board, spend up to 2 Action Points, end turn, watch the threat spread and events fire, reassess. Per run: first detection, containment fight, eradication, recovery, PIR. Target run length 15-20 minutes, roughly 20-30 turns.

## The board

A network of roughly 24 nodes connected by visible cables, rendered as low-poly 3D on a tilted fixed camera (pan and zoom, no rotation). Node types:

- **Workstations** (most of the board): low value, spread fodder.
- **Servers**: valuable, downtime hurts the score.
- **The Domain Controller**: crown jewels. If it's encrypted, the run is lost.
- **The Backup Node**: holds your restore credits. If it's encrypted, no more restores this run.
- **Routers**: junctions with many links. Isolating one is powerful and expensive in downtime.

v1 ships one hand-authored topology defined in JSON. Phase 4 adds seeded procedural layouts for run variety.

## The threat (v1: the WORM)

- Patient zero appears at a random edge workstation, then the worm dwells: it spreads unopposed for a few turns (dwellTurns, default 2, in sim config) before the incident is detected. The player is paged to an established foothold at T+01h, not a lone patient zero. (Added in Phase 3.5 as a structural difficulty lever: a single patient zero was trivially found and cured, so a competent player never lost.)
- Each INFECTED node makes one spread attempt per turn against each clean neighbour along a live cable: 60 percent base chance to infect each. (Revised in Phase 2 from a single random-cable attempt, which measured at a 100 percent fizzle rate on the v1 topology because high-degree junctions diluted their three attempts. Per-cable spread reaches 60 percent encryption in about 86 percent of undefended runs, mean 7.8 turns.)
- A node infected for 3 consecutive turns becomes ENCRYPTED: it stops spreading, but it is lost unless restored, and its value bleeds score every turn.
- Detection: nodes with EDR coverage (about 60 percent of the board, marked visibly) reveal infection the turn it lands. Uncovered nodes show clean until scanned or until they encrypt. This is the fog of war.

Threat variants (STALKER, which routes toward the backup node; LOUDMOUTH, fast but always visible) are designed here but parked for v2.

## Player actions (2 AP per turn)

- **Deploy Sensor** (1 AP): place permanent EDR coverage on one node. Like built-in EDR it reveals that node's true state on placement and any future infection the turn it lands. No neighbour reveal: coverage is bought one node at a time. (Redesigned in Phase 3.6 from Scan, which revealed a node plus all its neighbours and let one cheap scan illuminate a whole segment.)
- **Isolate** (1 AP): cut all cables on a node. Spread cannot cross. The node's services go offline, costing score each turn it stays isolated and adding to business pressure (weighted by type, a router hurts the business more than a workstation). Added in Phase 3.7: when pressure maxes, the business force-reconnects the single longest-isolated node at the start of the next spread phase and it becomes a PIR finding. Pressure falls as things reconnect.
- **Reconnect** (1 AP): restore a node's cables, relieving business pressure.
- **Patch** (2 AP): immunise a clean node permanently. Cannot patch an infected node.
- **Restore** (2 AP, consumes 1 backup credit of 2): return an infected or encrypted node to clean. Useless if the backup node is lost.
- **Emergency budget** (once per run, free): the CISO grants +2 AP this turn. The PIR permanently records "emergency change control bypassed". Sometimes worth it. Always embarrassing.

## Win, lose, and the clock

- **Win**: no INFECTED nodes remain on the board (everything clean, patched, encrypted-and-accepted, or restored). Containment achieved.
- **Lose**: the Domain Controller is encrypted, or 60 percent of the board is encrypted.
- The HUD clock runs T+01h, T+02h per turn. Time-to-contain feeds the PIR.

## The Post-Incident Review (end screen, the signature)

One page, Fira Code, generated from the actual run. The sibling of Tailgate's Engagement Report and the second entry in the house style: games that end in security documents.

- Metrics: time to detect, time to contain, blast radius (percent of estate encrypted), downtime hours from isolation, backup credits burned, whether emergency change control was bypassed.
- Findings drawn from real events with in-fiction timestamps ("Finding: EDR coverage gap on FINANCE-02 allowed undetected lateral movement, T+04h. Severity: High").
- Rating: **NEAR MISS** (nothing encrypted, ever), **CONTAINED** (blast radius under 25 percent, crown jewels intact), **REPORTABLE INCIDENT** (blast radius 25-60 percent: the regulator hears about this), **TOTAL LOSS** (defeat).
- [ NEW INCIDENT ] resets cleanly. Best ratings persist in localStorage.

## Visual direction

Low-poly procedural geometry only: server racks and workstation towers as clean boxed shapes, cables as glowing tubes, the whole board lit dramatically against near-black. Cyan versus magenta is the entire colour story: infrastructure and UI in cold cyan, infection creeping visibly along cables in hot magenta, encryption rendered as a node going dark with magenta edges. Unknown (unscanned, uncovered) nodes desaturated. Everything readable at a glance from the fixed camera.

## Audio direction

All synthesised, same module pattern as Tailgate. War-room ambience: low room tone, distant phone, keyboard clatter that intensifies with blast radius. UI sounds: clean cyan-feeling confirms, a nasty rising sting when a node encrypts, a flat dead-line tone on defeat. The end-turn spread phase gets a short tense pulse per spread attempt so the threat is audible, not just visible.

## Accessibility (design constraints, not afterthoughts)

- Turn-based by design: no timers on decisions, no twitch inputs, ever.
- State is never colour alone: infected nodes pulse and carry a canvas-painted glyph, encrypted nodes change shape (lid open), EDR coverage is an icon not a tint. The cyan/magenta story is reinforced by shape and motion everywhere.
- DOM UI throughout: HUD text scale setting, high-contrast toggle, screen shake toggle.
- Mouse-first (point and click a node, click an action), with full keyboard alternatives: tab through nodes, hotkeys for actions, Enter to end turn.

## Build phases

Each phase: one branch, one PR, CI green, deployed preview, Craig merges.

**Phase -1, the spike.** Throwaway-quality but kept in repo: Vite + Three.js + TS scaffold, fixed tilted camera with pan and zoom, a 6x6 grid of instanced boxes, hover highlight and click-select via raycaster, one directional light with shadows, a DOM overlay naming the selected box, deployed to Vercel at 60fps. Committed straight to main as the initial commits, then branch protection goes on.
Done when: the deployed URL runs at 60fps and clicking boxes works. This phase exists to prove the pipeline before any design lands on it.

**Phase 0, the skeleton.** Proper scaffold: ESLint, folder structure, web fonts bundled, palette module, CI workflow (typecheck, lint, gitleaks) as blocking checks, README stub with the pitch, CREDITS.md with the two fonts, .gitignore with .env.
Done when: CI blocks a deliberately failing test PR and passes a clean one.

**Phase 1, the board.** The hand-authored topology loading from JSON: 24 nodes, five types visually distinct, cables, node selection and inspection in the DOM overlay, EDR coverage markers, pan and zoom polished.
Done when: the whole network is readable at a glance and every node can be selected and inspected.

**Phase 2, the spread.** The simulation core, this game's hard maths: infection, the 3-turn encryption clock, spread attempts along live cables, fog of war (EDR reveal, hidden states), end-turn resolution, deterministic seeded RNG so runs are reproducible for debugging. Debug overlay showing true state versus visible state.
Done when: watching the worm eat an undefended board is legible, reproducible from a seed, and already tense.

**Phase 3, the fight.** All six actions with AP economy, isolation downtime costs, backup credits, the patch and restore rules, win and lose conditions, the emergency budget with its PIR flag.
Done when: a full incident is winnable and losable, and every action's trade-off is felt.

**Phase 4, the run.** Seeded procedural topologies within tuned constraints, run stats collection, the Post-Incident Review generating from real run data with all four ratings reachable, localStorage bests, [ NEW INCIDENT ].
Done when: the PIR accurately narrates any run, all four ratings have been reached and documented in the PR.

**Phase 5, the war room.** Lighting drama, infection creep animated along cables, encryption transitions, the full synthesised audio pass, juice (camera easing, shake with toggle), UI polish to the identity spec.
Done when: a 30-second clip of a spread phase looks and sounds like a finished game.

**Phase 6, ship.** Runbook-styled main menu, settings (volume, text scale, high contrast, shake), instrument-don't-tune balance worksheet, README with GIFs and the how-it-was-built note, CREDITS.md audit, favicon and title, cold-cache production check.
Done when: a public URL and a repo that belongs on the CV next to Tailgate.

## v2 parking lot (do not build in v1)

STALKER and LOUDMOUTH threat variants, insider threat events, campaign or meta-progression across incidents, daily seed challenge, audit mode replay, additional topolgy themes (OT network, cloud VPC), gamepad, mobile, and multiplayer never.
