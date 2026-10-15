// Turns a game's shot counts into dot positions on the half-court diagram.
// The game log stores counts (FGM/FGA, 3PM/3PA) but not court locations, so the counts
// are exact and the positions are schematic: threes sit along the arc, twos fill the
// space inside it.

const HOOP_X = 250
const HOOP_Y = 52.5
const ARC_ANGLE = 1.185 // radians from straight down to where the arc meets the corner lines
const THREE_RADIUS = 248
const CORNER_LENGTH = 124
const GOLDEN = 0.618034

function toCount(value) {
  const count = Math.round(Number(value))
  return Number.isFinite(count) && count > 0 ? count : 0
}

// Spreads `hits` made shots evenly through `total` attempts so misses are not clumped.
function spreadMakes(total, hits) {
  const results = []
  let placed = 0

  for (let i = 0; i < total; i += 1) {
    const isHit = Math.round(((i + 1) * hits) / total) > placed
    if (isHit) {
      placed += 1
    }
    results.push(isHit)
  }

  return results
}

function threePointSpot(index, total) {
  const arcLength = THREE_RADIUS * ARC_ANGLE * 2
  const along = ((index + 0.5) / total) * (arcLength + CORNER_LENGTH * 2)

  if (along < CORNER_LENGTH) {
    return [14, 24 + along]
  }

  if (along > CORNER_LENGTH + arcLength) {
    return [486, 24 + (along - CORNER_LENGTH - arcLength)]
  }

  const angle = -ARC_ANGLE + (along - CORNER_LENGTH) / THREE_RADIUS
  return [HOOP_X + THREE_RADIUS * Math.sin(angle), HOOP_Y + THREE_RADIUS * Math.cos(angle)]
}

function twoPointSpot(index, total) {
  const radius = 24 + 180 * Math.sqrt((index + 0.5) / total)
  const angle = (((index * GOLDEN) % 1) - 0.5) * 2.6
  return [HOOP_X + radius * Math.sin(angle), HOOP_Y + radius * Math.cos(angle)]
}

export function buildShotChart(game) {
  const fga = toCount(game?.fga)
  const fgm = Math.min(toCount(game?.fgm), fga)
  const threeAttempts = Math.min(toCount(game?.three_pa), fga)
  const threeMade = Math.min(toCount(game?.three_pm), threeAttempts, fgm)
  const twoAttempts = fga - threeAttempts
  const twoMade = Math.min(Math.max(fgm - threeMade, 0), twoAttempts)

  const twoResults = spreadMakes(twoAttempts, twoMade)
  const threeResults = spreadMakes(threeAttempts, threeMade)

  const shots = [
    ...twoResults.map((made, i) => ({ made, spot: twoPointSpot(i, twoAttempts) })),
    ...threeResults.map((made, i) => ({ made, spot: threePointSpot(i, threeAttempts) })),
  ]

  const step = Math.min(70, 1000 / Math.max(shots.length, 1))

  return {
    made: fgm,
    missed: fga - fgm,
    dotRadius: fga > 28 ? 7.5 : 9,
    shots: shots.map(({ made, spot }, i) => ({
      x: Math.round(spot[0] * 10) / 10,
      y: Math.round(spot[1] * 10) / 10,
      made,
      delay: Math.round(i * step),
    })),
  }
}
