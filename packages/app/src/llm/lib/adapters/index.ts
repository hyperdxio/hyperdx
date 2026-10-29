import { openinferenceAdapter } from './openinference';
import { openllmetryAdapter } from './openllmetry';
import { semconvAttributesAdapter } from './semconvAttributes';
import { semconvEventsAdapter } from './semconvEvents';
import { MessageAdapter } from './shared';
import { vercelAiAdapter } from './vercelAi';

/**
 * Adapters in precedence order. The current attribute-based semconv comes
 * first (the standard going forward), then the key-path dialects whose
 * detection is unambiguous, then Vercel AI, with span-event conventions as
 * the last resort since events often coexist with richer attributes.
 */
export const MESSAGE_ADAPTERS: MessageAdapter[] = [
  semconvAttributesAdapter,
  openllmetryAdapter,
  openinferenceAdapter,
  vercelAiAdapter,
  semconvEventsAdapter,
];
