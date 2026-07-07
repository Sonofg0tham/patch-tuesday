# Patch Tuesday

It's 03:12 on a Wednesday and the on-call phone is screaming. Ransomware is loose on the network and you're the incident lead. Every turn is an hour of the incident. Isolate segments, burn your backups wisely, patch what you can reach, and decide what the board gets told. Turn-based tactics where every mechanic is real incident response tradecraft, ending in the Post-Incident Review you deserve.

**Play it:** https://patch-tuesday.vercel.app

Status: in development. The full design lives in [GAME_DESIGN.md](GAME_DESIGN.md).

## Stack

Three.js, TypeScript (strict) and Vite. No game engine, no asset files: every visual is procedural geometry and every sound is synthesised. The 3D canvas draws the board; all UI is DOM.

## Development

```bash
npm install
npm run dev        # local dev server
npm run build      # production build
npm run typecheck  # TypeScript, no emit
npm run lint       # ESLint
```

Every pull request must pass typecheck, lint and a gitleaks secret scan in CI before it can merge.

## Credits

Fonts and licences are recorded in [CREDITS.md](CREDITS.md). Everything else is generated in code.

Second game in the [Sonofg0tham](https://github.com/Sonofg0tham) security games series, after [Tailgate](https://github.com/Sonofg0tham/tailgate).
