// recharts doesn't re-export this from its top-level index (only
// getNiceTickValues, from the same internal module, is public).
declare module 'recharts/lib/util/scale/getNiceTickValues' {
  export function getTickValuesFixedDomain(
    domain: [number, number],
    tickCount: number,
    allowDecimals?: boolean,
  ): number[];
}
