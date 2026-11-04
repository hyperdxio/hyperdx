/**
 * Public surface of the exemplars hooks. Split out of a single 430-line module;
 * consumers (and the several test files that `jest.mock('@/hooks/useExemplars')`)
 * import from here, so the internal file layout stays free to change.
 */
export {
  capExemplarsPerBucket,
  normalizePrometheusExemplars,
} from './exemplarNormalize';
export { useExemplars } from './useExemplars';
export {
  type ExemplarTraceMeta,
  useExemplarTraceMeta,
} from './useExemplarTraceMeta';
