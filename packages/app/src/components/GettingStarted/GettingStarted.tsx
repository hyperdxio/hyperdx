import React, { useState } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import {
  Connection,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Box,
  Button,
  Card,
  Divider,
  Flex,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconDatabase,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconPlus,
  IconServer,
} from '@tabler/icons-react';

import { TableSourceForm } from '@/components/SourceForm';
import { IS_LOCAL_MODE } from '@/config';
import { useConnections } from '@/connection';
import { useSources } from '@/source';
import { capitalizeFirstLetter } from '@/utils';

import styles from './GettingStarted.module.scss';

interface SystemStatus {
  storageReady: boolean;
  telemetryEndpointsReady: boolean;
  dataReceived: boolean;
}

interface GettingStartedProps {
  activeStep?: 1 | 2;
  endpoint?: string;
  apiKey?: string;
  systemStatus?: SystemStatus;
  docsUrl?: string;
  onConfigureDataSources?: () => void;
  onConfirmAndExplore?: () => void;
  /** Mock sources for Storybook/testing */
  mockSources?: TSource[];
  /** Mock connections for Storybook/testing */
  mockConnections?: Connection[];
}

const CheckIconStatus = () => (
  <svg
    className={styles.statusIcon}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="8" cy="8" r="8" fill="#22c55e" />
    <path
      d="M5 8l2 2 4-4"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PendingIcon = () => (
  <svg
    className={styles.statusIcon}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="8" cy="8" r="7" stroke="#c0c0c0" strokeWidth="2" fill="none" />
  </svg>
);

interface StepProps {
  number: number;
  title: string;
  description?: React.ReactNode;
  isActive?: boolean;
  isCompleted?: boolean;
  isLast?: boolean;
  children?: React.ReactNode;
}

const Step: React.FC<StepProps> = ({
  number,
  title,
  description,
  isActive = false,
  isCompleted = false,
  isLast = false,
  children,
}) => {
  return (
    <div className={styles.step}>
      <div className={styles.stepRow}>
        {/* Step number circle */}
        <div className={styles.stepIndicator}>
          <div
            className={`${styles.stepNumber} ${
              isCompleted
                ? styles.stepNumberCompleted
                : isActive
                  ? styles.stepNumberActive
                  : styles.stepNumberInactive
            }`}
          >
            {isCompleted ? <IconCheck size={12} stroke={2.5} /> : number}
          </div>
          {/* Connector line */}
          {!isLast && (
            <div className={styles.connector}>
              <div
                className={`${styles.connectorLine} ${isCompleted ? styles.connectorLineCompleted : ''}`}
              />
            </div>
          )}
        </div>

        {/* Step content */}
        <div className={styles.stepBody}>
          <div
            className={`${styles.stepTitle} ${
              isCompleted
                ? styles.stepTitleCompleted
                : !isActive
                  ? styles.stepTitleInactive
                  : ''
            }`}
          >
            {title}
          </div>
          {description && isActive && (
            <div className={styles.stepDescription}>{description}</div>
          )}
          {children && isActive && (
            <div className={styles.stepContent}>{children}</div>
          )}
        </div>
      </div>
    </div>
  );
};

/* Sources List for Step 2 */
function SourcesList({
  onAddSource,
  mockSources,
  mockConnections,
}: {
  onAddSource?: () => void;
  mockSources?: TSource[];
  mockConnections?: Connection[];
}) {
  const { data: fetchedConnections } = useConnections();
  const { data: fetchedSources } = useSources();

  // Use mock data if provided, otherwise use fetched data
  const connections = mockConnections ?? fetchedConnections;
  const sources = mockSources ?? fetchedSources;
  const [editedSourceId, setEditedSourceId] = useState<string | null>(null);
  const [isCreatingSource, setIsCreatingSource] = useState(false);

  return (
    <Card withBorder p="md" radius="sm" className={styles.sourcesCard}>
      <Stack gap="md">
        {sources?.map((s, index) => (
          <React.Fragment key={s.id}>
            <Flex justify="space-between" align="center">
              <div>
                <Text size="sm" fw={500}>
                  {s.name}
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  <Group gap="xs">
                    {capitalizeFirstLetter(s.kind)}
                    <Group gap={4}>
                      <IconServer size={11} />
                      {connections?.find(c => c.id === s.connection)?.name}
                    </Group>
                    <Group gap={4}>
                      {s.from && (
                        <>
                          <IconDatabase size={11} />
                          {s.from.databaseName}
                          {s.kind === SourceKind.Metric ? '' : '.'}
                          {s.from.tableName}
                        </>
                      )}
                    </Group>
                  </Group>
                </Text>
              </div>
              <Button
                variant="subtle"
                size="xs"
                onClick={() =>
                  setEditedSourceId(editedSourceId === s.id ? null : s.id)
                }
              >
                {editedSourceId === s.id ? (
                  <IconChevronUp size={13} />
                ) : (
                  <IconChevronDown size={13} />
                )}
              </Button>
            </Flex>
            {editedSourceId === s.id && (
              <Box mt="xs">
                <TableSourceForm
                  sourceId={s.id}
                  onSave={() => setEditedSourceId(null)}
                />
              </Box>
            )}
            {index < (sources?.length ?? 0) - 1 && <Divider />}
          </React.Fragment>
        ))}

        {isCreatingSource && (
          <>
            <Divider />
            <TableSourceForm
              isNew
              onCreate={() => setIsCreatingSource(false)}
              onCancel={() => setIsCreatingSource(false)}
            />
          </>
        )}

        {!IS_LOCAL_MODE && (
          <Flex justify="flex-end" pt="md">
            <Button
              variant="default"
              size="sm"
              leftSection={<IconPlus size={14} />}
              onClick={() => {
                setIsCreatingSource(true);
                onAddSource?.();
              }}
            >
              Add source
            </Button>
          </Flex>
        )}
      </Stack>
    </Card>
  );
}

export const GettingStarted: React.FC<GettingStartedProps> = ({
  activeStep = 1,
  endpoint = '',
  apiKey = '',
  systemStatus = {
    storageReady: true,
    telemetryEndpointsReady: true,
    dataReceived: true,
  },
  docsUrl = 'https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/overview',
  onConfigureDataSources,
  onConfirmAndExplore,
  mockSources,
  mockConnections,
}) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [copiedApiKey, setCopiedApiKey] = useState(false);

  const maskedApiKey = '••••••••••••••••';

  const handleCopyEndpoint = () => {
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  const handleCopyApiKey = () => {
    setCopiedApiKey(true);
    setTimeout(() => setCopiedApiKey(false), 2000);
  };

  return (
    <Card withBorder p="md" radius="sm" className={styles.container}>
      <div className={styles.stepper}>
        {/* Step 1: Ingest data */}
        <Step
          number={1}
          title="Ingest data"
          isActive={activeStep === 1}
          isCompleted={activeStep > 1}
          description={
            activeStep === 1 ? (
              <Text size="sm" c="dimmed">
                Start seeing logs, metrics, and traces from your application in
                minutes. Need help?{' '}
                <Anchor
                  href={docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                >
                  Check out our documentation.
                </Anchor>
              </Text>
            ) : undefined
          }
        >
          {activeStep === 1 && (
            <>
              <Text fw={600} size="sm" className={styles.sectionTitle}>
                System status
              </Text>

              <div className={styles.statusItem}>
                {systemStatus.storageReady ? (
                  <CheckIconStatus />
                ) : (
                  <PendingIcon />
                )}
                <Text size="sm">Storage is ready</Text>
              </div>

              <div className={styles.statusItem}>
                {systemStatus.telemetryEndpointsReady ? (
                  <CheckIconStatus />
                ) : (
                  <PendingIcon />
                )}
                <Text size="sm">Telemetry endpoints are ready</Text>
              </div>

              <div className={styles.statusItem}>
                {systemStatus.dataReceived ? (
                  <CheckIconStatus />
                ) : (
                  <PendingIcon />
                )}
                <Text size="sm">Data received</Text>
              </div>

              <Text size="sm" mt="sm">
                Use the endpoint and API key below to send logs, metrics, or
                traces.
              </Text>

              {/* Credentials Table */}
              <div className={styles.credentialsTable}>
                <div className={styles.credentialsRow}>
                  <div className={styles.credentialsLabel}>Endpoint</div>
                  <div className={styles.credentialsValue}>{endpoint}</div>
                  <div className={styles.credentialsActions}>
                    <CopyToClipboard
                      text={endpoint}
                      onCopy={handleCopyEndpoint}
                    >
                      <Tooltip
                        label={copiedEndpoint ? 'Copied!' : 'Copy endpoint'}
                        withArrow
                      >
                        <button
                          className={styles.iconButton}
                          aria-label="Copy endpoint"
                        >
                          {copiedEndpoint ? (
                            <IconCheck size={16} />
                          ) : (
                            <IconCopy size={16} />
                          )}
                        </button>
                      </Tooltip>
                    </CopyToClipboard>
                  </div>
                </div>
                <div className={styles.credentialsRow}>
                  <div className={styles.credentialsLabel}>API key</div>
                  <div className={styles.credentialsValue}>
                    {showApiKey ? apiKey : maskedApiKey}
                  </div>
                  <div className={styles.credentialsActions}>
                    <Tooltip
                      label={showApiKey ? 'Hide API key' : 'Show API key'}
                      withArrow
                    >
                      <button
                        className={styles.iconButton}
                        onClick={() => setShowApiKey(!showApiKey)}
                        aria-label={
                          showApiKey ? 'Hide API key' : 'Show API key'
                        }
                      >
                        {showApiKey ? (
                          <IconEyeOff size={16} />
                        ) : (
                          <IconEye size={16} />
                        )}
                      </button>
                    </Tooltip>
                    <CopyToClipboard text={apiKey} onCopy={handleCopyApiKey}>
                      <Tooltip
                        label={copiedApiKey ? 'Copied!' : 'Copy API key'}
                        withArrow
                      >
                        <button
                          className={styles.iconButton}
                          aria-label="Copy API key"
                        >
                          {copiedApiKey ? (
                            <IconCheck size={16} />
                          ) : (
                            <IconCopy size={16} />
                          )}
                        </button>
                      </Tooltip>
                    </CopyToClipboard>
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className={styles.buttonGroup}>
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.secondaryButton}
                >
                  View ingest data docs
                  <IconExternalLink size={15.5} />
                </a>
                <button
                  className={styles.primaryButton}
                  onClick={onConfigureDataSources}
                >
                  Configure data sources
                  <IconArrowRight size={15.5} />
                </button>
              </div>
            </>
          )}
        </Step>

        {/* Step 2: Configure data sources */}
        <Step
          number={2}
          title="Configure data sources"
          isActive={activeStep === 2}
          isLast
          description={
            activeStep === 2 ? (
              <Text size="sm" c="dimmed">
                We've pre-configured the default OpenTelemetry (OTel) schema for
                you. Review the sources below or add custom tables if you use a
                different schema. Need help?{' '}
                <Anchor
                  href="https://clickhouse.com/docs/use-cases/observability/clickstack"
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                >
                  Check out our documentation.
                </Anchor>
              </Text>
            ) : undefined
          }
        >
          {activeStep === 2 && (
            <>
              <SourcesList
                mockSources={mockSources}
                mockConnections={mockConnections}
              />

              {/* Confirm button */}
              <div className={styles.buttonGroup}>
                <button
                  className={styles.primaryButton}
                  onClick={onConfirmAndExplore}
                >
                  Confirm and explore
                </button>
              </div>
            </>
          )}
        </Step>
      </div>
    </Card>
  );
};

export default GettingStarted;
