import React from 'react';
import { formatDate } from '@hyperdx/common-utils/dist/utils';

import { useUserPreferences } from './useUserPreferences';

type DateLike = number | string | Date;

type DateFormat = 'normal' | 'short' | 'withMs' | 'time';

const parse = (time: DateLike) => {
  if (time instanceof Date) {
    return time;
  }
  return new Date(time);
};

export const useFormatTime = () => {
  const {
    userPreferences: { isUTC, timeFormat },
  } = useUserPreferences();

  return React.useCallback(
    (time: DateLike, { format }: { format?: DateFormat } | undefined = {}) => {
      try {
        const date = parse(time);
        return formatDate(date, {
          clock: timeFormat,
          isUTC,
          format,
        });
      } catch (err) {
        console.error(err, time);
        return 'Unknown date';
      }
    },
    [isUTC, timeFormat],
  );
};

export const FormatTime = ({
  value,
  format,
}: {
  value?: DateLike;
  format?: DateFormat;
}) => {
  const formatTime = useFormatTime();

  if (!value) {
    return null;
  }

  return <>{formatTime(value, { format })}</>;
};
