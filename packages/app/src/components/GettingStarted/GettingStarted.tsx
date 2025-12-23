import React from 'react';
import { Connection, TSource } from '@hyperdx/common-utils/dist/types';
import { Anchor, Button, Card, Text } from '@mantine/core';
import {
  IconArrowRight,
  IconCircleCheckFilled,
  IconExternalLink,
  IconRefresh,
} from '@tabler/icons-react';

import { CredentialsTable } from './CredentialsTable';
import { DemoBanner } from './DemoBanner';
import { SourcesList } from './SourcesList';
import { Step } from './Step';

import styles from './GettingStarted.module.scss';

interface SystemStatus {
  storageReady: boolean;
  telemetryEndpointsReady: boolean;
  dataReceived: boolean;
}

export interface GettingStartedProps {
  activeStep?: 1 | 2;
  endpoint?: string;
  apiKey?: string;
  systemStatus?: SystemStatus;
  docsUrl?: string;
  onConfigureDataSources?: () => void;
  onConfirmAndExplore?: () => void;
  /** Callback when "Explore demo project" banner is clicked */
  onExploreDemoProject?: () => void;
  /** Mock sources for Storybook/testing */
  mockSources?: TSource[];
  /** Mock connections for Storybook/testing */
  mockConnections?: Connection[];
}

const CheckIconStatus = () => (
  <IconCircleCheckFilled size={16} className={styles.statusIconSuccess} />
);

const PendingIcon = () => (
  <IconRefresh size={16} className={styles.statusIconPending} />
);

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
  onExploreDemoProject,
  mockSources,
  mockConnections,
}) => {
  const allSystemsReady =
    systemStatus.storageReady &&
    systemStatus.telemetryEndpointsReady &&
    systemStatus.dataReceived;

  return (
    <div className={styles.wrapper}>
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
                  Start seeing logs, metrics, and traces from your application
                  in minutes. Need help?{' '}
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

                <CredentialsTable endpoint={endpoint} apiKey={apiKey} />

                {/* Buttons */}
                <div className={styles.buttonGroup}>
                  <Button
                    component="a"
                    href={docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="default"
                    size="sm"
                    rightSection={<IconExternalLink size={15.5} />}
                  >
                    View ingest data docs
                  </Button>
                  <Button
                    variant="light"
                    onClick={onConfigureDataSources}
                    disabled={!allSystemsReady}
                  >
                    Configure data sources
                    <IconArrowRight size={15.5} />
                  </Button>
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
                  We've pre-configured the default OpenTelemetry (OTel) schema
                  for you. Review the sources below or add custom tables if you
                  use a different schema. Need help?{' '}
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
                  <Button onClick={onConfirmAndExplore} variant="light">
                    Confirm and explore
                  </Button>
                </div>
              </>
            )}
          </Step>
        </div>
      </Card>

      {/* Demo Banner - Outside the main card */}
      {onExploreDemoProject && <DemoBanner onClick={onExploreDemoProject} />}
    </div>
  );
};

export default GettingStarted;
