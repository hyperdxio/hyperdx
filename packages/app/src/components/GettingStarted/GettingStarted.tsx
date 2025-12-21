import React, { useState } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Anchor, Card, Text, Tooltip } from '@mantine/core';
import {
  IconArrowRight,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconEye,
  IconEyeOff,
} from '@tabler/icons-react';

import styles from './GettingStarted.module.scss';

interface SystemStatus {
  storageReady: boolean;
  telemetryEndpointsReady: boolean;
  dataReceived: boolean;
}

interface GettingStartedProps {
  endpoint: string;
  apiKey: string;
  systemStatus?: SystemStatus;
  docsUrl?: string;
  onConfigureDataSources?: () => void;
}

const CheckIcon = () => (
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
  isLast?: boolean;
  children?: React.ReactNode;
}

const Step: React.FC<StepProps> = ({
  number,
  title,
  description,
  isActive = false,
  isLast = false,
  children,
}) => {
  return (
    <div className={styles.step}>
      <div className={styles.stepRow}>
        {/* Step number circle */}
        <div className={styles.stepIndicator}>
          <div
            className={`${styles.stepNumber} ${isActive ? styles.stepNumberActive : styles.stepNumberInactive}`}
          >
            {number}
          </div>
          {/* Connector line */}
          {!isLast && (
            <div className={styles.connector}>
              <div className={styles.connectorLine} />
            </div>
          )}
        </div>

        {/* Step content */}
        <div className={styles.stepBody}>
          <div
            className={`${styles.stepTitle} ${!isActive ? styles.stepTitleInactive : ''}`}
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

export const GettingStarted: React.FC<GettingStartedProps> = ({
  endpoint,
  apiKey,
  systemStatus = {
    storageReady: true,
    telemetryEndpointsReady: true,
    dataReceived: true,
  },
  docsUrl = 'https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/overview',
  onConfigureDataSources,
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
          isActive
          description={
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
          }
        >
          <Text fw={600} size="sm" className={styles.sectionTitle}>
            System status
          </Text>

          <div className={styles.statusItem}>
            {systemStatus.storageReady ? <CheckIcon /> : <PendingIcon />}
            <Text size="sm">Storage is ready</Text>
          </div>

          <div className={styles.statusItem}>
            {systemStatus.telemetryEndpointsReady ? (
              <CheckIcon />
            ) : (
              <PendingIcon />
            )}
            <Text size="sm">Telemetry endpoints are ready</Text>
          </div>

          <div className={styles.statusItem}>
            {systemStatus.dataReceived ? <CheckIcon /> : <PendingIcon />}
            <Text size="sm">Data received</Text>
          </div>

          <Text size="sm" mt="sm">
            Use the endpoint and API key below to send logs, metrics, or traces.
          </Text>

          {/* Credentials Table */}
          <div className={styles.credentialsTable}>
            <div className={styles.credentialsRow}>
              <div className={styles.credentialsLabel}>Endpoint</div>
              <div className={styles.credentialsValue}>{endpoint}</div>
              <div className={styles.credentialsActions}>
                <CopyToClipboard text={endpoint} onCopy={handleCopyEndpoint}>
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
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
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
        </Step>

        {/* Step 2: Configure data sources */}
        <Step number={2} title="Configure data sources" isLast />
      </div>
    </Card>
  );
};

export default GettingStarted;
