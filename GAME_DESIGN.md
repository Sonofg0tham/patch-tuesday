# Patch Tuesday - Game Design Document

v0.2 - owner: Craig McCart (Sonofg0tham)
Status: pre-production. Numbers are starting values, all tunable via data files.

## Phase 8 amendment - Incident Command

Approved by Craig on 16 August 2026. This amendment reopens the Phase 3.10 pacing lock and the original win condition because measured runs finish around T+05h, before business pressure, recovery and the adaptive score mature. It supersedes only the conflicting rules named below.

- **Run target:** 12 to 18 human minutes. Bot turns are a repeatable balance proxy, not a claim about wall time. The measured gate expects greedy runs to average T+10h to T+14h and random-legal runs to average T+10h to T+16h.
- **Threat scheduler:** each infected source contributes at most one uniformly selected eligible target per hour. Seeded candidate order is shuffled and a global cap of three limits attempts. The Phase 8 lock uses dwell 2, spread chance 1.00 and infection lifetime 7.
- **Containment:** clearing visible infection does not auto-win. When no infection is visible, the player may declare containment. A false declaration discards unused AP, records a High finding and resolves the normal active-response hour without revealing hidden locations. A true declaration enters recovery immediately with fresh AP and no extra threat or cost step.
- **Recovery:** no spread or infection ageing. Reconnect and Restore remain available. Advancing a recovery hour still resolves isolation ageing, downtime score, pressure and pressure-driven overrides. Filing the PIR ends a successful run immediately. Critical services left isolated create a finding and cap the rating at CONTAINED.
- **Recovery economy correction:** the first Phase 8 lock retained two backup credits. With dwell 2 and spread chance 1.00, detection starts with at least three infections, so two restores made NEAR MISS structurally unreachable. The controller reopened only this dependency and locked three backup credits after the full balance gate passed.
- **Forecast:** on by default, still fog-safe and optional in settings. Forecast risk uses amber. Magenta remains exclusive to observable compromise.
- **Audio verdict:** recovery releases tension, but the final musical cadence belongs to filing the PIR.
- **Unchanged locks:** AP, action costs, loss conditions, node values, pressure values, topology constraints and the zero-asset rule remain locked unless the measured sweep proves a named dependency cannot pass.

## Pitch

It's 03:12 on a Wednesday and the on-call phone is screaming. Ransomware is loose on the network and you're the incident lead. Every turn is an hour of the incident. Isolate segments, burn your backups wisely, patch what you can reach, and decide what the board gets told. Turn-based tactics where every mechanic is real incident response tradecraft, ending in the Post-Incident Review you deserve.

## Design pillars

1. **Every turn is a trade-off.** Actions are scarce. Isolating a segment stops the spread and takes the business offline. Restoring burns a backup you might need more later. There are no free moves. Isolation is borrowed time, not a wall: leave too much of the estate cut off and business pressure builds until the business overrides IT and forces your oldest containment back online, ready or not.
2. **Visibility is a resource.** You fight what you can see, and you cannot see everywhere. EDR coverage has gaps, and the scariest node on the board is the one showing green because nothing is watching it. You can buy visibility, one node at a time, by spending an action point to deploy a sensor, so every square of the board you can see cost you a move you could not spend on containment.
3. **Every mechanic is real IR tradecraft.** Containment, eradication, recovery, the emergency change that bypasses control and haunts the review. If it wouldn't appear in a real post-incident review, it doesn't go in the game.
4. **The review is the reckoning.** Win or lose, the run ends in a Post-Incident Review generated from what actually happened. Mistakes are findings. The game is allowed to be funny about them.

## Core loop

Per turn (about 60-90 seconds of thought): read the board, spend up to 2 Action Points, end the hour, watch the threat resolve and events fire, reassess. Per run: first detection, containment fight, eradication, declaration, recovery, PIR. The human run target is 12-18 minutes. The bot proxy bands are T+10h to T+14h for greedy runs and T+10h to T+16h for random-legal runs.

## The board

A network of roughly 24 nodes connected by visible cables, rendered as low-poly 3D on a tilted fixed camera (pan and zoom, no rotation). Node types:

- **Workstations** (most of the board): low value, spread fodder.
- **Servers**: valuable, downtime hurts the score.
- **The Domain Controller**: crown jewels. If it's encrypted, the run is lost.
- **The Backup Node**: holds your restore credits. If it's encrypted, no more restores this run.
- **Routers**: junctions with many links. Isolating one is powerful and expensive in downtime.

v1 ships the hand-authored topology (the MERIDIAN MUTUAL scenario, defined in JSON) alongside seeded procedural estates (RANDOM ESTATE), added in Phase 4. The generator's constraints are derived from the measured hand-authored board and held inside the balance gate, so procedural boards vary the layout without moving the difficulty.

## The threat (v1: the WORM)

- Patient zero appears at a random edge workstation, then the worm spreads unopposed for 2 dwell turns before the incident is detected. The player is paged to an established foothold at T+01h, not a lone patient zero. Phase 3.10 previously locked dwell at 3; that historical baseline is recorded below and was superseded by the Phase 8 measured lock.
- Each INFECTED, non-isolated source contributes at most one attempt per hour. Its eligible clean, non-isolated neighbours are sorted, one target is selected uniformly through the seeded RNG, source-target candidates are shuffled through the same RNG, and the global cap is applied before each selected attempt rolls its spread chance. This Phase 8 scheduler prevents hubs from multiplying the number of attempts while preserving their routing options and deterministic replay.
- A node infected for 7 consecutive turns becomes ENCRYPTED: it stops spreading, but it is lost unless restored, and its value bleeds score every turn.
- Detection: nodes with EDR coverage (about 60 percent of the board, marked visibly) reveal infection the turn it lands. Uncovered nodes show clean until scanned or until they encrypt. This is the fog of war.

Threat variants (STALKER, which routes toward the backup node; LOUDMOUTH, fast but always visible) are designed here but parked for v2.

## Player actions (2 AP per turn)

- **Deploy Sensor** (1 AP): place permanent EDR coverage on one node. Like built-in EDR it reveals that node's true state on placement and any future infection the turn it lands. No neighbour reveal: coverage is bought one node at a time. (Redesigned in Phase 3.6 from Scan, which revealed a node plus all its neighbours and let one cheap scan illuminate a whole segment.)
- **Isolate** (1 AP): cut all cables on a node. Spread cannot cross. The node's services go offline, costing score each turn it stays isolated and adding to business pressure (weighted by type, a router hurts the business more than a workstation). Added in Phase 3.7: when pressure maxes, the business force-reconnects the single longest-isolated node at the start of the next spread phase and it becomes a PIR finding. Pressure falls as things reconnect.
- **Reconnect** (1 AP): restore a node's cables, relieving business pressure.
- **Patch** (2 AP): immunise a clean node permanently. Cannot patch an infected node.
- **Restore** (2 AP, consumes 1 backup credit of 3): return an infected or encrypted node to clean. Useless if the backup node is lost.
- **Emergency budget** (once per run, free): the CISO grants +2 AP this turn. The PIR permanently records "emergency change control bypassed". Sometimes worth it. Always embarrassing.

## v1 economy baseline (Phase 3.10, partially reopened by Phase 8)

These figures preserve the historical Phase 3.10 baseline. Later controller-authorised Phase 8 measurements reopened infection lifetime, then backup credits when the all-four-ratings acceptance check proved NEAR MISS unreachable. The current values are recorded in the Phase 8 measured lock below and live in `src/sim/config.ts`.

- **Historical foothold baseline:** dwellTurns 3, spreadChance 0.6, encryptAfterTurns 3, lossBlastRadius 0.6. The Phase 8 lock supersedes the first three values; lossBlastRadius remains 0.6.
- **Historical economy:** apPerTurn 2, backupCredits 2, emergency +2 AP once per run. Action costs: deploy sensor / isolate / reconnect 1 AP, patch / restore 2 AP, failed-patch probe 1 AP. Phase 8 superseded only backupCredits, raising it to 3 after the all-ratings acceptance check proved two restores could not clear the three-infection minimum handover.
- **Pressure:** pressureMax 100, recovery 10 per turn, weights workstation 4 / server 12 / backup 12 / domain-controller 15 / router 18.

**Historical Phase 3.10 baseline (4,000 games each, single v1 topology):** the greedy reference bot won **67 percent** (inside the former 40-70 percent target band), the random-legal bot won **18 percent**, and an undefended board reached 60 percent encryption in **87 percent** of runs, mean **4.9 player-turns** from detection. The current measurements are in the Phase 8 lock below.

These numbers were reached through the measured 3.5-3.9 sequence, one lever at a time (dwell, sensors, business pressure, the AP cut, backup credits), each with its own before/after instrumentation. That sequence remains the audit trail. Phase 8 adds a second audit trail: sweep attempt caps three, four and five; then dwell two and three only if needed; then spread chance 0.55, 0.60 and 0.65 only if needed. Change one lever per pass and record the result.

**Superseded Phase 8 backup-2 lock (4,000 greedy, 4,000 random-legal and 4,000 undefended seeds):** spread attempt cap **3**, dwell **2**, spread chance **1.00**, infection lifetime **7** and backup credits **2**. Raw greedy survival was **97.30 percent** and greedy wins below 25 percent blast radius measured **69.75 percent**. Random-legal wins measured **27.82 percent**; greedy and random average finishes were **T+12.63h** and **T+14.86h**; finishes before T+06h were **0.00 percent**; runs active after T+16h were **21.86 percent**; undefended loss was **100.00 percent**; and **25.40 percent** of greedy runs reached 80 percent business pressure. All eight pacing bands passed, but the all-four-ratings acceptance check later proved that two credits made NEAR MISS structurally unreachable from the minimum three-infection handover.

**Current Phase 8 backup-3 lock (4,000 greedy, 4,000 random-legal and 4,000 undefended seeds):** the controller reopened backup credits only. Three credits produced raw greedy survival **98.500 percent**, greedy sub-reportable containment **63.450 percent**, random-legal wins **28.075 percent**, greedy finish **T+13.16925h**, random finish **T+15.014h**, early finishes **0.000 percent**, late runs **20.875 percent**, undefended loss **100.000 percent** and greedy high pressure **20.700 percent**. Against backup 2, those movements were +1.200, -6.300 and +0.255 percentage points for raw greedy, sub-reportable greedy and random wins; +0.53925h and +0.154h for the two finish averages; no change to early finish or undefended loss; -0.985 percentage points for late runs; and -4.700 percentage points for greedy high pressure. Every gate still passes, and a legal public-action run now reaches NEAR MISS without changing threat tempo, AP, action costs, pressure or loss rules.

## Win, lose, and the clock

- **Containment declaration**: available only when no infection is visible. It costs no AP but discards unused AP and commits the hour. If hidden infection remains, record a High premature-declaration finding and resolve the normal active-response hour without localising the hidden threat. If no true infection remains, enter recovery immediately with fresh AP and no threat, pressure or downtime step.
- **Recovery**: only Reconnect and Restore remain available. Advancing an hour cannot spread or age infection, but it still accrues isolation age, downtime score and pressure, including any pressure-driven business override. File the PIR at any time to win. Filing with an isolated router, server, backup node or Domain Controller records an unrecovered critical-service finding and caps the rating at CONTAINED.
- **Win**: file the PIR after a successful containment declaration.
- **Lose**: the Domain Controller is encrypted, or 60 percent of the board is encrypted.
- The HUD clock runs T+01h, T+02h per turn. Time-to-contain feeds the PIR.

## The Post-Incident Review (end screen, the signature)

One page, Fira Code, generated from the actual run. The sibling of Tailgate's Engagement Report and the second entry in the house style: games that end in security documents.

- Metrics: time to detect, time to contain, blast radius (percent of estate encrypted), downtime hours from isolation, backup credits burned, whether emergency change control was bypassed.
- Findings drawn from real events with in-fiction timestamps ("Finding: EDR coverage gap on FINANCE-02 allowed undetected lateral movement, T+04h. Severity: High").
- Rating: **NEAR MISS** (no additional encryption after detection), **CONTAINED** (blast radius under 25 percent, crown jewels intact), **REPORTABLE INCIDENT** (blast radius 25-60 percent: the regulator hears about this), **TOTAL LOSS** (defeat).
  - NEAR MISS was redefined in Phase 4, when the live 3-turn dwell could hand over an already encrypted node at T+01h. You are judged on the response, not the inherited dwell, so NEAR MISS is now "no encryption after detection, no premature declaration and no unrecovered critical service". The Phase 8 timing lock does not change that rating rule. A premature declaration or unrecovered critical-service finding caps the rating at CONTAINED. REPORTABLE and TOTAL LOSS are unchanged.
  - Time to detect is where the current 2-turn dwell is revealed to the player for the first time: "initial access preceded detection by 2 hours".
- [ NEW INCIDENT ] resets cleanly. Best rating per named scenario and a short run history persist in localStorage.

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
Shipped: a seeded generator (`src/data/topology-gen.ts`, constraints in `GEN_CONFIG`) building hub-and-spoke estates whose properties are derived from the measured hand-authored board; MERIDIAN MUTUAL kept as a named scenario alongside RANDOM ESTATE (`src/data/scenarios.ts`); the incident-briefing entry screen; the real PIR (`src/sim/pir.ts` for the logic, `src/ui/pir.ts` for the page) with the redefined NEAR MISS; localStorage best-per-scenario and run history. The balance gate (`npm run gen`) proved the locked economy survives procedural variety (greedy 66 percent, random 19 percent over 4,000 generated boards). The generator's structural variety was capped by that gate: cross-segment cycles measurably collapsed the casual-play floor, so `extraEdges` is pinned to zero and every board is a spanning tree. Widening it needs a new balance decision, per the Phase 3.10 lock.

**Phase 5, the war room.** Lighting drama, infection creep animated along cables, encryption transitions, the full synthesised audio pass, juice (camera easing, shake with toggle), UI polish to the identity spec.
Done when: a 30-second clip of a spread phase looks and sounds like a finished game.
Shipped: a dramatic lighting rig (dim ambient, cyan uplight, a crown light on the DC, atmospheric fog) governed by a nystagmus **visibility floor** knob (`VISUAL_CONFIG.visibilityFloor` in `src/config/visual.ts`); procedural glow via additive halo sprites (no postprocessing, so the 60fps floor holds, worst frame ~0.8ms with everything on); the infected pulse, the encryption transition (the node darkening and its edges igniting, not a swap), magenta compromised cables, isolation rings that warm to amber with business pressure, and an override flash. All board state is driven from the visible view, so the fog of war survives the lighting: a hidden infection glows exactly like a clean node. The full synthesised soundscape lives in `src/audio/audio.ts` (Tailgate module pattern, keyed by name, file-swap escape hatch, master-volume placeholder for Phase 6), unlocked on the first gesture per the autoplay policy. Motion ships **calm by default** (nystagmus): the state pulses stay because motion is a required non-colour cue, but screen shake ships at zero and `prefers-reduced-motion` attenuates the rest. The PIR is delivered onto the desk with a slide-in. Every motion and audio call has a config knob for Craig's feel pass, listed in the Phase 5 PR's playtest script.

**Phase 6, ship.** Runbook-styled main menu, settings (volume, text scale, high contrast, shake), instrument-don't-tune balance worksheet, README with GIFs and the how-it-was-built note, CREDITS.md audit, favicon and title, cold-cache production check.
Done when: a public URL and a repo that belongs on the CV next to Tailgate.

**Phase 7, the next level.** Not in the original plan; added after v1 shipped, on Craig's call to raise the production values. Three fronts: how the image is formed, the missing music pillar, and the perception chore sitting on top of the tactics.

Rendering: the board was flat `MeshStandardMaterial` with no tone mapping, no reflections and no post-processing, which is why it read as a prototype rather than a game. Now it runs ACES filmic tone mapping, a procedurally prefiltered environment map (`src/render/textures.ts` builds a small room and pushes it through `PMREMGenerator`, so metal finally has something to reflect), PBR maps painted in code from tileable value noise and a Sobel height-to-normal pass, and an `EffectComposer` chain of bloom plus one combined film pass (grade, chromatic aberration, vignette, static scanlines, grain) in `src/render/postfx.ts`. Node state now drives a per-instance emissive attribute rather than only a diffuse colour, so an infected chassis is a real light source that blooms and lights its neighbours; cables carry a travelling pulse that turns magenta and accelerates when the link is compromised. Every silhouette from Phase 1 is unchanged (the accessibility contract depends on them) but each now contains real hardware detail: bevels, vent banks, rack sleds, drive bays, the DC beacon. The zero-asset rule holds exactly: not one texture, model or audio file was added.

Audio: `src/audio/music.ts` adds the score the design always called for, six layers on a four-chord loop in D natural minor that never resolves, each gated by how bad the incident is, so the music is a readout of the board rather than a bed under it. It ends on a verdict: the tritone holds unresolved on a loss, recovery releases tension without resolving, and the suspended dominant lands when the PIR is filed. `src/audio/reverb.ts` synthesises its own impulse response, so every sound sits in the same room. Effects are placed in the stereo field from where they happened on the board.

Gameplay: the threat forecast (`src/sim/forecast.ts`), an assist that rings every node the worm could reach next turn. It mirrors the spread rules exactly but reads the visible view, so it is blind wherever the EDR coverage is, which makes it an expression of pillar 2 rather than a workaround for it. Phase 7 shipped it off by default. Craig's Phase 8 decision switches it on by default while keeping the setting, and uses amber for possible routes so magenta remains exclusive to observable compromise.

Quality tiers: post-processing is the one thing here that could threaten the 60fps floor, so it ships with three tiers and a working bypass at LOW, auto-selected by watching the real frame rate and steppable by hand in settings. Measured on the full HIGH tier: 0.43ms average frame, 1.8ms worst, against a 16.7ms budget.

Done when: a still of the board is indistinguishable from a shipped indie tactics game, the score is audibly reading the incident, and the frame budget is unmoved.

**Phase 8, Incident Command.** Reopen the measured pacing and win condition, then build the missing dramatic arc around the existing mechanics. Add containment declaration and recovery, a fog-safe event theatre, handover and live guidance, truthful state markers, action-specific procedural effects and sound, safe-area layout, PIR chronology fixes and production debug gating. Keep every visual and sound procedural.

Done when: the new 4,000-seed balance gate passes, competent human runs land at 12-18 minutes, each decision explains its visible consequence, End Hour is tense without leaking fog, all shipped text scales remain usable, and browser playtesting confirms the full handover-to-PIR journey with a clean console.

## v2 parking lot (do not build in v1)

STALKER and LOUDMOUTH threat variants, insider threat events, campaign or meta-progression across incidents, daily seed challenge, audit mode replay, additional topolgy themes (OT network, cloud VPC), gamepad, mobile, and multiplayer never.
