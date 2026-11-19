/* ──────────────────────────────────────────────────────────────
   HUMAN SCALE — one place for the sizes everything is built to.
   1 unit = 1 metre. Every building, prop and road is measured
   against the 1.8 m player, so a door is a door and a storey is
   a storey. Change a number here, not a magic number in a file.
────────────────────────────────────────────────────────────── */

export const SCALE = {
  /** the player: capsule is 1.76 m, the avatar about 1.8 m */
  person: 1.8,
  /** doors: clear opening */
  doorH: 2.2,
  doorW: 1.1,
  /** a residential / shop-house storey, floor to floor */
  floor: 3.2,
  /** a commercial / office storey */
  officeFloor: 3.8,
  /** windows: sill height and size */
  sill: 0.9,
  windowW: 1.3,
  windowH: 1.55,
  /** stairs: rise and tread (comfortable, and within the player's autostep) */
  stairRise: 0.18,
  stairRun: 0.28,
  /** roads */
  lane: 3.3,
  roadLocal: 7, // two narrow lanes, no divider
  roadMain: 10, // street with parking
  roadAvenue: 16, // divided avenue
  highway: 24, // 3 + 3 lanes with a median and shoulders
  walkway: 3.5,
  kerb: 0.15,
  /** street furniture */
  lampHeight: 6.2,
  benchSeat: 0.45,
  /** vehicles */
  carLength: 4.5,
  carWidth: 1.85,
  /** trees: shade trees 8-14 m, ornamental 4-6 m */
  shadeTree: [8, 14] as const,
} as const

/** a quick sanity check used by the dev audit: is a dimension within a plausible human range? */
export const plausible = {
  storey: (h: number) => h >= 2.5 && h <= 4.6,
  door: (h: number) => h >= 2.0 && h <= 2.6,
  window: (h: number) => h >= 0.9 && h <= 2.6,
}
