// Ambient temperature by depth. The planet is cold first and hot later: the glacier's core
// is the coldest place on the map, and the Hollow at the bottom is the hottest.

/** [depth in tiles, °C] */
export const TEMP_POINTS: [number, number][] = [
  [0, -35],
  [30, -55],
  [85, -78],
  [130, -50],
  [220, 0],
  [300, 55],
  [400, 140],
  [480, 230],
  [560, 320],
  [600, 360],
];

export function tempAtDepth(d: number): number {
  const p = TEMP_POINTS;
  if (d <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (d <= p[i][0]) {
      const [d0, t0] = p[i - 1];
      const [d1, t1] = p[i];
      return t0 + ((t1 - t0) * (d - d0)) / (d1 - d0);
    }
  }
  return p[p.length - 1][1];
}
