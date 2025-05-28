import { IS_OSS } from '@/config';

const GH_LINK = 'https://github.com/hyperdxio/hyperdx/issues';

export const ContactSupportText = () => {
  if (IS_OSS) {
    return (
      <span>
        Please open an issue on{' '}
        <a href={GH_LINK} target="_blank">
          GitHub
        </a>
        .
      </span>
    );
  }

  return <span>Please contact support.</span>;
};
