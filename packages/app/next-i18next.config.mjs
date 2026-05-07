/** @type {import('next-i18next/pages').UserConfig} */
const nextI18NextConfig = {
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ja'],
  },
  defaultNS: 'common',
  keySeparator: false,
  nsSeparator: false,
};

export default nextI18NextConfig;
