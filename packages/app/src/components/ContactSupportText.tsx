import { Link } from '@clickhouse/click-ui';

import { IS_OSS } from '@/config';

import styles from './ContactSupportText.module.scss';

const GH_LINK = 'https://github.com/hyperdxio/hyperdx/issues';

export const ContactSupportText = () => {
  if (IS_OSS) {
    return (
      <span>
        Please open an issue on{' '}
        <Link
          className={styles.inlineLink}
          href={GH_LINK}
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </Link>
        .
      </span>
    );
  }

  return <span>Please contact support.</span>;
};
