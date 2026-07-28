import { Trans, useTranslation } from 'react-i18next';

import { IS_OSS } from '@/config';

const GH_LINK = 'https://github.com/hyperdxio/hyperdx/issues';

export const ContactSupportText = () => {
  const { t } = useTranslation('common');

  if (IS_OSS) {
    return (
      <span>
        <Trans
          i18nKey="support.github"
          ns="common"
          components={{ github: <a href={GH_LINK} target="_blank" /> }}
        />
      </span>
    );
  }

  return <span>{t('support.contact')}</span>;
};
