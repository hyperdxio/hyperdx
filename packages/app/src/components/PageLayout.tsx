// TODO: Remove `src/components/PageLayout.tsx` from `knip.json` → `workspaces["packages/app"].ignoreFiles`
// once enough app pages import `PageLayout` that Knip no longer reports it as unused.

import classNames from 'classnames';

import { PageHeader, type PageHeaderProps } from './PageHeader';

import styles from './PageLayout.module.scss';

export type PageLayoutProps = Pick<
  PageHeaderProps,
  'title' | 'leading' | 'actions' | 'breadcrumbs' | 'children'
> & {
  /** Page content below the header. */
  content: React.ReactNode;
  /** Custom header when `title` / `leading` / `actions` are not enough. */
  header?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  'data-testid'?: string;
  fillViewport?: boolean;
  /** Apply standard page body padding (`var(--mantine-spacing-sm)`). */
  padded?: boolean;
};

export function PageLayout({
  title,
  leading,
  actions,
  breadcrumbs,
  children: headerChildren,
  header,
  content,
  className,
  contentClassName,
  'data-testid': testId,
  fillViewport = false,
  padded = false,
}: PageLayoutProps) {
  const headerNode =
    header ??
    (title != null ||
    leading != null ||
    actions != null ||
    breadcrumbs != null ||
    headerChildren ? (
      <PageHeader
        title={title}
        leading={leading}
        actions={actions}
        breadcrumbs={breadcrumbs}
      >
        {headerChildren}
      </PageHeader>
    ) : null);

  return (
    <div
      className={classNames(
        styles.root,
        fillViewport && styles.fillViewport,
        className,
      )}
      data-testid={testId}
    >
      {headerNode}
      <div
        className={classNames(
          styles.content,
          padded && styles.padded,
          contentClassName,
        )}
      >
        {content}
      </div>
    </div>
  );
}
