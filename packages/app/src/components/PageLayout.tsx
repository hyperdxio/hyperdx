import classNames from 'classnames';

import { PageHeader, type PageHeaderProps } from './PageHeader';

import styles from './PageLayout.module.scss';

/**
 * Two valid composition forms — pick the one that matches your page,
 * preferring the structured slots whenever possible:
 *
 * 1. **Structured slots** — pass `title` / `leading` / `actions` /
 *    `breadcrumbs` directly to `PageLayout`. These forward into an
 *    internal `<PageHeader>`. Preferred for the standard
 *    title-or-breadcrumb + horizontal-toolbar layout
 *    (see `KubernetesDashboardPage`).
 *
 * 2. **Custom `header`** — pass a fully-formed `<PageHeader>{...}`
 *    (or any node) when the toolbar can't be expressed as leading +
 *    actions (see `SessionsPage`'s full-width source/search/time/run
 *    row). Reach for this only when the structured slots actively
 *    misrepresent the layout.
 *
 * See `PageHeaderProps` for the underlying slot semantics.
 */
export type PageLayoutProps = Pick<
  PageHeaderProps,
  'title' | 'leading' | 'actions' | 'breadcrumbs' | 'children'
> & {
  /** Page content below the header. */
  content: React.ReactNode;
  /**
   * Escape hatch for pages whose header doesn't fit the structured
   * `title` / `leading` / `actions` / `breadcrumbs` slots. Pass a
   * fully-formed `<PageHeader>{...}>` (or any node) here; the
   * structured-slot props above are ignored when `header` is set.
   * Prefer the structured slots when the layout fits.
   */
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
