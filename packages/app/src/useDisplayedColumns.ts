import { useState } from 'react';

// TODO: Instead of prop drilling additional columns, we can consider using React.Context or Jotai
export const useDisplayedColumns = (initialColumns: string[] = []) => {
  const [displayedColumns, setDisplayedColumns] =
    useState<string[]>(initialColumns);

  const toggleColumn = (column: string) => {
    if (displayedColumns.includes(column)) {
      setDisplayedColumns(displayedColumns.filter(c => c !== column));
    } else {
      setDisplayedColumns([...displayedColumns, column]);
    }
  };

  return { displayedColumns, setDisplayedColumns, toggleColumn };
};
