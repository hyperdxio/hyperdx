import { StacktraceFrame } from './types';

export const useSourceMappedFrame = (frame: StacktraceFrame) => {
  return {
    isLoading: false,
    error: null,
    enrichedFrame: null,
  };
};
