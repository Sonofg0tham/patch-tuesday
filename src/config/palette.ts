// The visual identity, decided in CLAUDE.md. Single source of truth for
// every colour in the game: TypeScript reads these values directly and
// applyPaletteToCss() mirrors them onto :root as CSS custom properties,
// so the DOM UI and the 3D board can never drift apart.

export const palette = {
  // Identity colours.
  base: '#0b0e14', // near-black background, the war room in the dark
  accent: '#4cc9f0', // cold cyan: the defence, the UI, clean nodes
  infection: '#f72585', // hot magenta, reserved exclusively for the threat
  text: '#c5cdd8', // cool grey UI text

  // Derived tones for the board.
  nodeBase: '#2f8fb3', // resting node, muted so hover and selection pop
  nodeHover: '#4cc9f0', // hover matches the accent
  nodeSelected: '#c8f0fc', // selected, near-white cyan
  ground: '#11161f', // board floor, a step up from the background
  keyLight: '#e8f6fc', // the war-room key light, cool white
} as const;

export type PaletteKey = keyof typeof palette;

// Writes every palette entry onto :root as --kebab-case custom properties
// (nodeBase becomes --node-base), so stylesheets consume the same values.
export function applyPaletteToCss(root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(palette)) {
    const cssName = `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    root.style.setProperty(cssName, value);
  }
}
