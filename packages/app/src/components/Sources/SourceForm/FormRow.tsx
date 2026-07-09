import React from 'react';
import { Box, Center, Flex, Stack, Text, Tooltip } from '@mantine/core';
import { IconHelpCircle } from '@tabler/icons-react';

export function FormRow({
  label,
  children,
  helpText,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  helpText?: string;
}) {
  return (
    // <Group grow preventGrowOverflow={false}>
    <Flex align="flex-start">
      <Flex align="center">
        <Stack
          justify="center"
          style={{
            maxWidth: 220,
            minWidth: 220,
            height: '36px',
          }}
        >
          {typeof label === 'string' ? (
            <Text tt="capitalize" size="sm">
              {label}
            </Text>
          ) : (
            label
          )}
        </Stack>
        <Center
          me="sm"
          ms="sm"
          style={{
            ...(!helpText ? { opacity: 0, pointerEvents: 'none' } : {}),
          }}
        >
          <Tooltip label={helpText} color="dark" c="white" multiline maw={600}>
            <IconHelpCircle size={20} className="cursor-pointer" />
          </Tooltip>
        </Center>
      </Flex>
      <Box
        w="100%"
        style={{
          minWidth: 0,
        }}
      >
        {children}
      </Box>
    </Flex>
  );
}
