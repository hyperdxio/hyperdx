import { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

import styles from './PageHeader.module.scss';

/**
 * Two valid composition forms, in order of preference:
 *
 * 1. **Structured slots** — `title` / `leading` / `actions` / `breadcrumbs`.
 *    Preferred for any page whose header fits the standard model: a title
 *    or breadcrumb trail above a horizontal toolbar that splits cleanly
 *    into a leading group (source picker, edit control) and a trailing
 *    group (Run, Save, time picker, refresh). Examples:
 *    - title-only:    `AlertsPage`, `DashboardsListPage`, `SavedSearchesListPage`
 *    - leading+actions: `DBServiceMapPage`
 *    - breadcrumbs+leading+actions: `KubernetesDashboardPage`
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
  /**
   * Single-row content that should be the only sticky element on the
   * page. When provided, the rest of the header (`breadcrumbs`,
   * `title` / `leading` / `actions`, `children`) becomes non-sticky
   * chrome that scrolls away, and this row is pinned to the top of the
   * scroll container instead.
   *
   * Use this for pages that have a tall header (e.g. dashboards with
   * breadcrumbs + an editable name + a query toolbar) where only a
   * specific row — typically the controls users keep reaching for while
   * scrolling, like the query toolbar — should remain visible.
   *
   * When omitted, the header behaves as a single sticky block.
   */
  stickyRow?: React.ReactNode;
};

export function PageHeader({
  title,
  leading,
  actions,
  breadcrumbs,
  children,
  className,
  'data-testid': testId,
  stickyRow,
}: PageHeaderProps) {
  const hasToolbar = title != null || leading != null || actions != null;
  const hasBreadcrumbs = breadcrumbs != null;
  const hasStickyRow = stickyRow != null;

  // Detect when the sticky row reaches `top: 0` of the scroll container.
  // `IntersectionObserver` with `rootMargin: -1px` at the top fires the
  // moment the row's top edge is clipped by the viewport (i.e. it has
  // become stuck). We use this to swap the row's `padding-top` between
  // "attached to chrome" (no top padding, tight at rest) and "stuck"
  // (standard top padding so the toolbar isn't flush with the edge).
  const stickyRowRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);
  useEffect(() => {
    const node = stickyRowRef.current;
    if (!node || !hasStickyRow) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(entry.intersectionRatio < 1),
      { threshold: [1], rootMargin: '-1px 0px 0px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasStickyRow]);
  // When a `stickyRow` is provided, the chrome above it scrolls with the
  // page. The chrome and the sticky row render as siblings (Fragment) so
  // the sticky row's containing block is the page layout root rather
  // than the chrome `<header>`, which lets it stay pinned for the full
  // length of the page rather than only the height of the header.
  const chromeStickyClass = hasStickyRow ? styles.notSticky : undefined;

  const toolbarInner = (
    <>
      <div className={styles.start}>
        {title != null && <h1 className={styles.title}>{title}</h1>}
        {leading}
      </div>
      {actions != null && <div className={styles.actions}>{actions}</div>}
    </>
  );

  const chrome =
    !hasToolbar && !hasBreadcrumbs ? (
      // Only render the chrome `<header>` if there's something to put in
      // it. A page with only a `stickyRow` (no breadcrumbs, no title)
      // skips the empty chrome entirely.
      children != null ? (
        <header
          className={classNames(styles.header, chromeStickyClass, className)}
          data-testid={testId}
        >
          {children}
        </header>
      ) : null
    ) : hasBreadcrumbs && hasToolbar ? (
      <header
        className={classNames(
          styles.header,
          styles.headerStacked,
          chromeStickyClass,
          className,
        )}
        data-testid={testId}
      >
        <div className={styles.breadcrumbsRow}>{breadcrumbs}</div>
        <div className={styles.toolbarRow}>{toolbarInner}</div>
      </header>
    ) : hasBreadcrumbs && !hasToolbar ? (
      <header
        className={classNames(
          styles.header,
          styles.headerStacked,
          chromeStickyClass,
          className,
        )}
        data-testid={testId}
      >
        <div className={styles.breadcrumbsRow}>{breadcrumbs}</div>
        {children}
      </header>
    ) : (
      <header
        className={classNames(styles.header, chromeStickyClass, className)}
        data-testid={testId}
      >
        {toolbarInner}
      </header>
    );

  if (!hasStickyRow) return chrome;

  return (
    <>
      {chrome}
      <div
        ref={stickyRowRef}
        className={classNames(
          styles.stickyRow,
          // While the row is in its at-rest position directly under
          // chrome, drop its `padding-top` so the chrome's bottom edge
          // and the toolbar read as one continuous block. Once stuck,
          // the standard padding kicks back in so the toolbar isn't
          // flush against the viewport edge.
          chrome != null && !isStuck && styles.stickyRowAttached,
        )}
        data-stuck={isStuck ? 'true' : undefined}
        data-testid="page-header-sticky-row"
      >
        {stickyRow}
      </div>
    </>
  );
}
