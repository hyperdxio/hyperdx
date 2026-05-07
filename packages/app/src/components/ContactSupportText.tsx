import { Trans } from 'next-i18next/pages';

import { IS_OSS } from '@/config';

const GH_LINK = 'https://github.com/hyperdxio/hyperdx/issues';

export const ContactSupportText = () => {
  if (IS_OSS) {
    return (
      <span>
        <Trans>Please open an issue on</Trans>{' '}
        <a href={GH_LINK} target="_blank">
          <Trans>GitHub</Trans>
        </a>
        .
      </span>
    );
  }

  return (
    <span>
      <Trans>Please contact support.</Trans>
    </span>
  );
};
