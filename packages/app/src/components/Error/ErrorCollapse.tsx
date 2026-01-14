import { useState } from 'react';
import { Button, Code, Collapse } from '@mantine/core';
import { IconAlertTriangle, IconChevronRight } from '@tabler/icons-react';

type ErrorCollapseProps = {
  summary: string;
  details: React.ReactNode;
};

export function ErrorCollapse({ summary, details }: ErrorCollapseProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="subtle"
        size="compact-xs"
        color="red"
        onClick={() => setOpen(o => !o)}
        leftSection={
          <IconChevronRight
            size={14}
            style={{
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 150ms ease',
            }}
          />
        }
      >
        <IconAlertTriangle size={14} className="me-2" /> {summary}
      </Button>

      <Collapse in={open}>
        <Code
          block
          c="red"
          mt="xs"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {details}
        </Code>
      </Collapse>
    </>
  );
}
