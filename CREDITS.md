# Credits

The target for this project is zero third-party asset files: all geometry is
procedural, all icons are canvas-painted, all audio is synthesised. Anything
that is not built in code gets an entry here, in the same commit that adds it.

## Fonts

Both fonts are bundled at build time from their Fontsource npm packages and
served from our own domain. Nothing is fetched from a CDN at runtime.

| Font | Use | Licence | Source |
| --- | --- | --- | --- |
| Chakra Petch | Display: menus, headings | [SIL Open Font License 1.1](https://openfontlicense.org) | [Fontsource](https://fontsource.org/fonts/chakra-petch), design by Cadson Demak |
| Fira Code | Monospace: HUD readouts, the PIR | [SIL Open Font License 1.1](https://openfontlicense.org) | [Fontsource](https://fontsource.org/fonts/fira-code), design by Nikita Prokopov |

## Favicon

`public/favicon.svg` is a hand-authored SVG mark (a clean cyan node cabled to
an infected magenta one), written by hand in the project's own palette. It was
not exported from any third-party tool or library and carries no external
licence, CC0 by construction like the rest of the visuals.

## Everything else

Audit, Phase 6: the only third-party assets in the repo are the two OFL fonts
above. There are no texture, model, or audio files, and the only image is the
hand-authored favicon. Everything on the board and in the soundscape is
generated in code at runtime. If any other asset appears in the repo without an
entry here, that is a bug.
