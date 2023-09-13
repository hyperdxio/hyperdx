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
          value: '30 second' as const,
          label: '30 Seconds Granularity',
        },
        {
          value: '1 minute' as const,
          label: '1 Minute Granularity',
        },
        {
          value: '5 minute' as const,
          label: '5 Minutes Granularity',
        },
        {
          value: '10 minute' as const,
          label: '10 Minutes Granularity',
        },
        {
          value: '30 minute' as const,
          label: '30 Minutes Granularity',
        },
        {
          value: '1 hour' as const,
          label: '1 Hour Granularity',
        },
        {
          value: '12 hour' as const,
          label: '12 Hours Granularity',
        },
        {
          value: '1 day' as const,
          label: '1 Day Granularity',
        },
        {
          value: '7 day' as const,
          label: '7 Day Granularity',
        },
      ]}
      onChange={onChange}
      value={value}
    />
  );
}
