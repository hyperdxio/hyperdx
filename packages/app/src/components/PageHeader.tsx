import classNames from 'classnames';

import styles from './PageHeader.module.scss';

/**
 * Two valid composition forms, in order of preference:
 *
 * 1. **Structured slots** — `title` / `leading` / `actions` / `breadcrumbs`.
 *    Preferred for any page whose header fits the standard model: a title
 *    or breadcrumb trail above a horizontal toolbar that splits cleanly
 *    into a leading group (source picker, edit control) and a trailing
 *    group (Run, Save, time picker, refresh). `KubernetesDashboardPage`,
 *    `AlertsPage`, and `DashboardsListPage` all use this form.
 *
 * 2. **Custom `children`** — the escape hatch for pages whose toolbar
 *    can't be expressed as leading + actions (e.g. a single full-width
 *    `<Group justify="space-between">` of mixed widgets where the search
 *    input grows to 50% width). `SessionsPage` uses this form. Reach
 *    for it only when the structured slots actively misrepresent the
 *    intended layout — otherwise the structured form keeps headers
 *    visually consistent across pages.
 */
export type PageHeaderProps = {
  /** Plain-text page title for standard list and tool pages. */
  title?: string;
  /** Content after the title (source picker, badge, edit control). */
  leading?: React.ReactNode;
  /** Right-aligned controls (time picker, Run/Save, sampling). */
  actions?: React.ReactNode;
  /**
   * Location trail inside the sticky header (above the toolbar when `leading` / `actions` exist).
   * Use with dashboard-style routes; omit `title` when the toolbar has inputs.
   */
  breadcrumbs?: React.ReactNode;
  /**
   * Escape hatch for pages whose toolbar can't be expressed as the
   * structured `title` / `leading` / `actions` slots (e.g.
   * `SessionsPage`'s full-width source/search/time/run row, or
   * `TeamPage`'s inline-editable team name). Prefer the structured
   * slots whenever the layout fits — they keep page chrome consistent
   * across the app.
   */
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
};

export function PageHeader({
  title,
  leading,
  actions,
  breadcrumbs,
  children,
  className,
  'data-testid': testId,
}: PageHeaderProps) {
  const hasToolbar = title != null || leading != null || actions != null;
  const hasBreadcrumbs = breadcrumbs != null;

  if (!hasToolbar && !hasBreadcrumbs) {
    return (
      <header
        className={classNames(styles.header, className)}
        data-testid={testId}
      >
        {children}
      </header>
    );
  }

  const toolbarInner = (
    <>
      <div className={styles.start}>
        {title != null && <h1 className={styles.title}>{title}</h1>}
        {leading}
      </div>
      {actions != null && <div className={styles.actions}>{actions}</div>}
    </>
  );

  if (hasBreadcrumbs && hasToolbar) {
    return (
      <header
        className={classNames(styles.header, styles.headerStacked, className)}
        data-testid={testId}
      >
        <div className={styles.breadcrumbsRow}>{breadcrumbs}</div>
        <div className={styles.toolbarRow}>{toolbarInner}</div>
      </header>
    );
  }

  if (hasBreadcrumbs && !hasToolbar) {
    return (
      <header
        className={classNames(styles.header, styles.headerStacked, className)}
        data-testid={testId}
      >
        <div className={styles.breadcrumbsRow}>{breadcrumbs}</div>
        {children}
      </header>
    );
  }

  return (
    <header
      className={classNames(styles.header, className)}
      data-testid={testId}
    >
      {toolbarInner}
    </header>
  );
}
