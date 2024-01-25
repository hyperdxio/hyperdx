import { Granularity } from './ChartUtils';
import DSSelect from './DSSelect';

export default function GranularityPicker({
  value,
  onChange,
}: {
  value: Granularity | undefined;
  onChange: (granularity: Granularity | undefined) => void;
}) {
  return (
    <DSSelect
      options={[
        {
          value: undefined,
          label: 'Auto Granularity',
        },
        {
          value: Granularity.ThirtySecond,
          label: '30 Seconds Granularity',
        },
        {
          value: Granularity.OneMinute,
          label: '1 Minute Granularity',
        },
        {
          value: Granularity.FiveMinute,
          label: '5 Minutes Granularity',
        },
        {
          value: Granularity.TenMinute,
          label: '10 Minutes Granularity',
        },
        {
          value: Granularity.ThirtyMinute,
          label: '30 Minutes Granularity',
        },
        {
          value: Granularity.OneHour,
          label: '1 Hour Granularity',
        },
        {
          value: Granularity.TwelveHour,
          label: '12 Hours Granularity',
        },
        {
          value: Granularity.OneDay,
          label: '1 Day Granularity',
        },
        {
          value: Granularity.SevenDay,
          label: '7 Day Granularity',
        },
      ]}
      onChange={onChange}
      value={value}
    />
  );
}
