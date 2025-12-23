import React, { useEffect, useRef, useState } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Tooltip } from '@mantine/core';
import { IconCheck, IconCopy, IconEye, IconEyeOff } from '@tabler/icons-react';

import styles from './GettingStarted.module.scss';

export interface CredentialsTableProps {
  endpoint: string;
  apiKey: string;
}

export const CredentialsTable: React.FC<CredentialsTableProps> = ({
  endpoint,
  apiKey,
}) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [copiedApiKey, setCopiedApiKey] = useState(false);

  const endpointTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiKeyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const maskedApiKey = '••••••••••••••••';

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (endpointTimeoutRef.current) {
        clearTimeout(endpointTimeoutRef.current);
      }
      if (apiKeyTimeoutRef.current) {
        clearTimeout(apiKeyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyEndpoint = () => {
    setCopiedEndpoint(true);
    if (endpointTimeoutRef.current) {
      clearTimeout(endpointTimeoutRef.current);
    }
    endpointTimeoutRef.current = setTimeout(
      () => setCopiedEndpoint(false),
      2000,
    );
  };

  const handleCopyApiKey = () => {
    setCopiedApiKey(true);
    if (apiKeyTimeoutRef.current) {
      clearTimeout(apiKeyTimeoutRef.current);
    }
    apiKeyTimeoutRef.current = setTimeout(() => setCopiedApiKey(false), 2000);
  };

  return (
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
              <button className={styles.iconButton} aria-label="Copy endpoint">
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
              {showApiKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          </Tooltip>
          <CopyToClipboard text={apiKey} onCopy={handleCopyApiKey}>
            <Tooltip
              label={copiedApiKey ? 'Copied!' : 'Copy API key'}
              withArrow
            >
              <button className={styles.iconButton} aria-label="Copy API key">
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
  );
};
