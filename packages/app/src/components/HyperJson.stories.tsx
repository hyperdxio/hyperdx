import type { Meta } from '@storybook/nextjs';

import HyperJson from './HyperJson';

const meta: Meta = {
  title: 'HyperJson',
  component: HyperJson,
};

export const Default = () => (
  <HyperJson
    data={{
      test: 'test',
      object: {
        test: 'test',
        array: [1, 2, 3],
      },
      array: [1, 2, 3],
      jsonLike: '{"test": "test"}',
    }}
    // getLineActions={getLineActions}
  />
);

export default meta;
