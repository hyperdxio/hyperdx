import { sparklinePointsFromGraphResults } from '../NumberTileBackgroundChart';

describe('sparklinePointsFromGraphResults', () => {
  const ts = '__hdx_time_bucket';
  const value = 'Count';

  it('maps graph results to ordered {x, y} points', () => {
    const graphResults = [
      { [ts]: 100, [value]: 5 },
      { [ts]: 200, [value]: 8 },
      { [ts]: 300, [value]: 3 },
    ];
    expect(sparklinePointsFromGraphResults(graphResults, ts, value)).toEqual([
      { x: 100, y: 5 },
      { x: 200, y: 8 },
      { x: 300, y: 3 },
    ]);
  });

  it('returns an empty array when the timestamp key is missing', () => {
    const graphResults = [{ [ts]: 100, [value]: 5 }];
    expect(
      sparklinePointsFromGraphResults(graphResults, undefined, value),
    ).toEqual([]);
  });

  it('returns an empty array when the value key is missing', () => {
    const graphResults = [{ [ts]: 100, [value]: 5 }];
    expect(
      sparklinePointsFromGraphResults(graphResults, ts, undefined),
    ).toEqual([]);
  });

  it('skips rows with non-finite or absent values', () => {
    const graphResults = [
      { [ts]: 100, [value]: 5 },
      { [ts]: 200, [value]: Number.NaN },
      { [ts]: 300 },
      { [ts]: 400, [value]: 9 },
    ];
    expect(sparklinePointsFromGraphResults(graphResults, ts, value)).toEqual([
      { x: 100, y: 5 },
      { x: 400, y: 9 },
    ]);
  });
});
