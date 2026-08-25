import { makeAlert } from '@/controllers/alerts';
import { AlertChannel, AlertThresholdType } from '@/models/alert';

// A channel type this repo doesn't define -- see
// models/__tests__/alert.test.ts for why. `value: any` (rather than an `as`
// cast) keeps this off the no-unsafe-type-assertion budget while still
// producing a value typed as AlertChannel for the call below.
const foreignChannel = (value: any): AlertChannel => value;

describe('makeAlert', () => {
  // makeAlert mirrors channels[0] into `channel` for readers that predate
  // multi-channel support. That mirroring must stay opaque: a downstream
  // fork's channel types must survive verbatim, not get projected onto
  // webhook-shaped fields.
  it('mirrors channels[0] into channel verbatim, preserving fields this repo does not define', () => {
    const exotic = foreignChannel({
      type: 'email',
      emailRecipients: ['ops@example.test'],
    });

    const result = makeAlert({
      interval: '5m',
      threshold: 1,
      thresholdType: AlertThresholdType.ABOVE,
      channels: [exotic],
    });

    expect(result.channel).toEqual(exotic);
    expect(result.channels).toEqual([exotic]);
  });
});
