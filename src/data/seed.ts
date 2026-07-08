// A short random run seed: readable, URL-safe, enough entropy for run variety.
// Shared by the entry point and the briefing screen so a minted seed looks the
// same wherever it comes from.
export function randomSeed(): string {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(36)
    .toUpperCase();
}
