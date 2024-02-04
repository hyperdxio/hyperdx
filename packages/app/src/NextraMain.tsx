import Image from 'next/legacy/image';
import { useConfig } from 'nextra-theme-docs';

import { useIsBlog } from './utils';

export default function NextraMain({
  children,
}: {
  children: React.ReactNode;
}) {
  const { frontMatter } = useConfig();

  const isBlog = useIsBlog();

  return (
    <div className="roboto">
      <h1
        className="mb-3 mt-3 fs-1 fw-bold"
        style={{
          borderBottom: 'none',
        }}
      >
        {frontMatter.title}
      </h1>
      {isBlog && (
        <>
          <div className="text-muted mt-2 fs-7 mb-4 text-center">
            {frontMatter.by != null && (
              <span className="d-inline-flex align-items-center">
                Written by{' '}
                <span className="mx-2">
                  <Image
                    width="24"
                    height="24"
                    className="rounded-circle"
                    src={`/assets/blog/profiles/${frontMatter.by}.jpg`}
                    alt={frontMatter.by}
                  />{' '}
                </span>{' '}
                {frontMatter.by} •&nbsp;
              </span>
            )}
            Published on {frontMatter.date}
          </div>
          {frontMatter.hero != null && (
            <div className="mb-4">
              <Image
                className="rounded"
                style={{ maxHeight: 380 }}
                src={frontMatter.hero}
                alt={frontMatter.title}
                width="100%"
                height="40%"
                layout="responsive"
                objectFit="cover"
              />
            </div>
          )}
        </>
      )}
      {children}
    </div>
  );
}
