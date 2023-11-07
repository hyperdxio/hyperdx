import { useState } from 'react';

// TODO: Instead of prop drilling additional columns, we can consider using React.Context or Jotai
export const useDisplayedColumns = () => {
  const [displayedColumns, setDisplayedColumns] = useState<string[]>([]);

  const toggleColumn = (column: string) => {
    if (displayedColumns.includes(column)) {
      setDisplayedColumns(displayedColumns.filter(c => c !== column));
    } else {
      setDisplayedColumns([...displayedColumns, column]);
    }
  };

  return { displayedColumns, setDisplayedColumns, toggleColumn };
};
