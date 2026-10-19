/** Ranked seeds become an eight-slot draw with byes for seeds 1 and 2 only.
 * SF1: 1 v winner(4,5); SF2: 2 v winner(3,6).
 */
export function topSixSlots(seeds: readonly number[]): (number | null)[] {
  if (seeds.length !== 6 || new Set(seeds).size !== 6) {
    throw new Error("Top 6 Playoff requires exactly six distinct qualifiers");
  }
  return [seeds[0], null, seeds[3], seeds[4], seeds[1], null, seeds[2], seeds[5]];
}
