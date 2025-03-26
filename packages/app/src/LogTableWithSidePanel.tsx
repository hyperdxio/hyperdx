export function LogTableWithSidePanel({
  config,
  isLive,
  onScroll,
  selectedSavedSearch,
  onRowExpandClick,
  onPropertyAddClick,
  onSettled,
  columnNameMap,
  hiddenColumns,
  initialHighlightedLineId,
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
    columns?: string[];
  };
  isLive: boolean;
  columnNameMap?: Record<string, string>;
  hiddenColumns?: any;
  initialHighlightedLineId?: string;

  onPropertyAddClick?: (name: string, value: string | boolean | number) => void;
  onRowExpandClick?: (logId: string, sortKey: string) => void;
  onScroll?: (scrollTop: number) => void | undefined;
  selectedSavedSearch?: any;
  onSettled?: () => void;
}) {
  return <h3>IMPLEMENT ME</h3>;
}
