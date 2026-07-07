# CLAUDE.md - Patch Tuesday

## What this project is

Patch Tuesday is a turn-based incident response tactics game. A low-poly 3D network grid, ransomware spreading node to node each turn, and the player as IR lead spending scarce actions to contain it. Roguelike runs of 15-20 minutes. Every mechanic is real incident response tradecraft.

Second game in Craig McCart's (Sonofg0tham) portfolio, following Tailgate (github.com/Sonofg0tham/tailgate). Ships publicly on Vercel, repo on GitHub. Code quality, licence hygiene and CI discipline matter as much as the game.

Full design in GAME_DESIGN.md. Read it before any feature work. If the two files disagree, ask Craig which wins.

## Who you're working with

Craig is a security professional and vibe coder. He owns design, architecture direction and all decisions; you write all the code. He directed Tailgate through six phase PRs with this exact workflow, so he knows the rhythm. He is still learning the deeper Git and CI machinery, so keep explaining those moments in plain English.

- Explain every change in plain English: what was built, why, how to test it by playing.
- Decisions: one recommendation plus one alternative, with plain reasons. Not a menu.
- Craig has dyspraxia and nystagmus. The game is turn-based partly for this reason: no twitch inputs anywhere, ever. See Accessibility in GAME_DESIGN.md.
- UK English everywhere: comments, UI copy, docs, commits.
- No em-dashes anywhere in this project. Comma, hyphen, or full stop.

## Stack

- Three.js + TypeScript (strict) + Vite. No game engine, no physics library.
- The 3D canvas renders the board only. All UI (HUD, menus, the Post-Incident Review) is a DOM overlay in HTML/CSS, for crisp text, scalable fonts and sane accessibility.
- ALL visuals are procedural: geometry built in code, no model files, no texture files, no image assets. Same rule for audio: everything synthesised via the WebAudio module pattern proven in Tailgate (one module, sounds keyed by name, file-swap as escape hatch).
- Rendering performance: instanced meshes for the grid, target 60fps on integrated graphics.
- Hosting: Vercel. Version control: GitHub. No backend, no accounts, no analytics. localStorage for settings and best runs.
- Node LTS, npm.

## Commands

Define in Phase 0 and keep green forever:

- `npm run dev` / `npm run build` / `npm run typecheck` / `npm run lint`

A phase is not done if typecheck or lint fails.

## CI (from Phase 0, not Phase 6)

Tailgate earned its CI in the final phase. This repo starts with it: GitHub Actions running typecheck, lint and gitleaks on every PR, all three as blocking required checks on main. Crib the working workflow from the Tailgate repo and explain any differences in plain English.

## Visual identity (never default)

Decided. Do not fall back to Tailwind blue or a generic font under any circumstances.

- Palette: base near-black `#0B0E14`. Primary accent cold cyan `#4CC9F0` (the defence, the UI, clean nodes). Infection is hot magenta `#F72585` and is reserved exclusively for the threat: if magenta appears, something is compromised. UI text cool grey `#C5CDD8`.
- Display font: Chakra Petch (menus, headings). Monospace: Fira Code (HUD readouts, the PIR, terminal flavour). Load as web fonts, bundled not CDN-fetched.
- Signature detail: the entire UI is framed as an incident war room. Turns are labelled as hours into the incident (T+01h, T+02h). The end screen is a one-page Post-Incident Review. Menus read like an IR runbook.
- The board itself fights in two colours: cyan infrastructure, magenta infection creeping along the cables.

## How to work

1. One phase at a time, in GAME_DESIGN.md order. Never start a later phase early.
2. One branch per phase (`phase-2-the-spread`), PR to main when the phase's "done when" list is met, typecheck, lint and CI green, preview URL in the PR description. Then stop. Craig reviews and merges.
3. PR descriptions in plain English: what was built, how to playtest, trade-offs made.
4. Data-driven everything: network topologies, threat behaviour, action costs, spread probabilities live in JSON or config modules, not scene logic. Craig tunes by editing numbers.
5. Instrument, don't tune. Fix only objective breaks against GAME_DESIGN.md. Anything that is a matter of feel gets a worksheet in the PR (value, current setting, what moving it does) and Craig does the feel pass himself.
6. Small commits, conventional messages.
7. Anything on the v2 parking lot in GAME_DESIGN.md: remind Craig it's parked and get explicit confirmation before building.

## Asset and licence rules

- The target is zero third-party asset files. Procedural geometry, canvas-painted icons, synthesised audio: CC0 by construction.
- CREDITS.md exists from Phase 0 and records the two fonts (OFL) and anything else that ever sneaks in. An asset without a CREDITS.md entry in the same commit is a bug.
- No paid APIs, no external services, no CDN-hosted game code.

## Security hygiene

- No secrets in the repo, ever. `.env` gitignored from Phase 0 despite v1 needing no secrets.
- New dependencies: well-known and maintained, justified in the PR, npm audit findings flagged.
- gitleaks blocks merges from day one.

## Out of scope for v1

Do not build without explicit confirmation: multiplayer or any server component, accounts or cloud saves, campaign/meta-progression, additional threat types beyond the v1 set, mobile or touch, gamepad, camera rotation. Full parking lot in GAME_DESIGN.md.
