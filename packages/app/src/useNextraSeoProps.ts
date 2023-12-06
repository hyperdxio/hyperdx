import { useConfig } from 'nextra-theme-docs';

import { useIsBlog, useIsDocs, useIsTerms } from './utils';

export default function useNextraSeoProps() {
  const isBlog = useIsBlog();
  const isDocs = useIsDocs();
  const isTerms = useIsTerms();

  const { frontMatter, title } = useConfig();

  const pageTitleSuffix = isBlog
    ? 'HyperDX Blog'
    : isDocs
    ? 'HyperDX Docs'
    : isTerms
    ? 'HyperDX'
    : '';

  return {
    title: `${frontMatter.title ?? title} - ${pageTitleSuffix}`,
    description: frontMatter.summary,
    openGraph: {
      ...(frontMatter.hero != null
        ? {
            images: [
              {
                url: `https://www.hyperdx.io${frontMatter.hero}`,
                alt: 'HyperDX Blog',
                type: 'image/png',
              },
            ],
          }
        : {}),
      site_name: 'HyperDX',
    },
    twitter: {
      site: '@hyperdxio',
      cardType: 'summary_large_image',
    },
  };
}
