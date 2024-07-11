import type { StacktraceFrame } from './types';

export const parseEvents = (__events?: string) => {
  try {
    return JSON.parse(__events || '[]')[0].fields.reduce(
      (acc: any, field: any) => {
        try {
          acc[field.key] = JSON.parse(field.value);
        } catch (e) {
          acc[field.key] = field.value;
        }
        return acc;
      },
      {},
    );
  } catch (e) {
    return null;
  }
};

export const getFirstFrame = (frames?: StacktraceFrame[]) => {
  if (!frames || !frames.length) {
    return null;
  }

  return (
    frames.find(frame => frame.in_app) ??
    frames.find(frame => !!frame.function || !!frame.filename) ??
    frames[0]
  );
};
