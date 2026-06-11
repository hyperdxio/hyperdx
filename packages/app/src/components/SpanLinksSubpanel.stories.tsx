import React from 'react';

import { SpanLinksSubpanel } from './SpanLinksSubpanel';

export default {
  title: 'Components/SpanLinksSubpanel',
  component: SpanLinksSubpanel,
};

const mockSpanLinks = [
  {
    TraceId: '6d4a1f0d2c3b4a5e6f7081929394a5b6',
    SpanId: '1a2b3c4d5e6f7081',
    TraceState: '',
    Attributes: {
      'link.kind': 'follows_from',
      'messaging.system': 'kafka',
    },
  },
  {
    TraceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    SpanId: '90a1b2c3d4e5f607',
    TraceState: 'rojo=00f067aa0ba902b7',
    Attributes: {},
  },
];

export const Default = () => <SpanLinksSubpanel spanLinks={mockSpanLinks} />;

export const SingleLink = () => (
  <SpanLinksSubpanel spanLinks={[mockSpanLinks[0]]} />
);

export const Empty = () => <SpanLinksSubpanel spanLinks={[]} />;
