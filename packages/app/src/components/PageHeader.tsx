import classNames from 'classnames';

import styles from './PageHeader.module.scss';

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
  /** Custom header when structured slots are not enough (e.g. editable team name). */
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
