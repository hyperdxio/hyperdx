import { Group, Loader } from '@mantine/core';

export const StacktraceFrame = ({
  filename,
  function: functionName,
  lineno,
  colno,
  isLoading,
}: {
  filename: string;
  function?: string;
  lineno: number;
  colno: number;
  isLoading?: boolean;
}) => {
  return (
    <Group gap="xs" display="inline-flex">
      <div
        className="text-slate-200 fs-8"
        style={{
          opacity: isLoading ? 0.8 : 1,
          filter: isLoading ? 'blur(1px)' : 'none',
        }}
      >
        {filename}
        <span className="text-slate-400">
          :{lineno}:{colno}
        </span>
        <span className="text-slate-400">{' in '}</span>
        {functionName && (
          <span
            style={{
              background: '#ffffff10',
              padding: '0 4px',
              borderRadius: 4,
            }}
          >
            {functionName}
          </span>
        )}
      </div>
      {isLoading && <Loader size="xs" color="gray" />}
    </Group>
  );
};
