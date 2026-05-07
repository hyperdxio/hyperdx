import { Trans } from 'next-i18next/pages';
import cx from 'classnames';
import { Button, Group, Modal } from '@mantine/core';
import { IconClipboard, IconClipboardCheck } from '@tabler/icons-react';

import api from './api';
import Clipboard from './Clipboard';

function CopyableValue({
  label = '',
  value,
}: {
  label?: React.ReactNode;
  value: string;
}) {
  return (
    <Clipboard text={value} className="d-flex mx-auto p-0 w-100">
      {({ isCopied }) => {
        return (
          <div
            className={cx(
              'd-flex w-100 py-2 px-2 gap-2 rounded align-items-center justify-content-between cursor-pointer',
              {
                'text-success': isCopied,
              },
            )}
          >
            <div className="fs-7 d-flex text-truncate align-items-center">
              {label}
              <pre className="m-0 user-select-all d-inline text-truncate fs-7 lh-1">
                {value}
              </pre>
            </div>
            <Group gap={2} wrap="nowrap" className={cx('fs-7 text-end')}>
              {isCopied ? (
                <IconClipboardCheck size={14} />
              ) : (
                <IconClipboard size={14} />
              )}
              {isCopied ? 'Copied!' : 'Copy'}
            </Group>
          </div>
        );
      }}
    </Clipboard>
  );
}

export default function InstallInstructionModal({
  show,
  onHide,
}: {
  show: boolean;
  onHide: () => void;
}) {
  const { data: team } = api.useTeam();

  return (
    <Modal
      opened={show}
      onClose={onHide}
      title="Start Sending Telemetry"
      size="lg"
      centered
    >
      <div className="inter">
        {team != null && (
          <div className="mb-4">
            <CopyableValue
              label={
                <span className="text-muted me-2">
                  <Trans>Your Ingestion API Key:</Trans>{' '}
                </span>
              }
              value={team.apiKey}
            />
          </div>
        )}
        <div className="fs-7 mb-4">
          <Trans>
            Click on a link below to view installation instructions for your
            application.
          </Trans>
        </div>
        <div className="fs-6 mb-2">
          <Trans>Backend</Trans>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/nodejs"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            <Trans>Node.js</Trans>
          </a>
          <span className="ms-2 text-muted">
            <Trans>(Logs + Traces)</Trans>
          </span>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/golang"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            <Trans>Go</Trans>
          </a>
          <span className="ms-2 text-muted">
            <Trans>(Logs + Traces)</Trans>
          </span>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/python"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            <Trans>Python</Trans>
          </a>
          <span className="ms-2 text-muted">
            <Trans>(Logs + Traces)</Trans>
          </span>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/java"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            <Trans>Java</Trans>
          </a>
          <span className="ms-2 text-muted">
            <Trans>(Logs + Traces)</Trans>
          </span>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/elixir"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            <Trans>Elixir</Trans>
          </a>
          <span className="ms-2 text-muted">
            <Trans>(Logs)</Trans>
          </span>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/ruby-on-rails"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            <Trans>Ruby on Rails</Trans>
          </a>
          <span className="ms-2 text-muted">
            <Trans>(Traces)</Trans>
          </span>
        </div>
        <div className="fs-6 mb-2 mt-4">
          <Trans>Platform</Trans>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/kubernetes"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            <Trans>Kubernetes</Trans>
          </a>
          <span className="ms-2 text-muted">
            <Trans>(Logs + Metrics)</Trans>
          </span>
        </div>
        <div className="fs-6 mb-2 mt-4">
          <Trans>Browser</Trans>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/browser"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            <Trans>JavaScript/TypeScript</Trans>
          </a>
          <span className="ms-2 text-muted">
            <Trans>(Logs + Traces)</Trans>
          </span>
        </div>
        <div className="fs-6 mb-2 mt-4">
          <Trans>Data Collector</Trans>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/opentelemetry#sending-otel-data"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            <Trans>OpenTelemetry</Trans>
          </a>
          <span className="ms-2 text-muted">
            <Trans>(Logs + Traces)</Trans>
          </span>
        </div>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => onHide()}>
            <Trans>Cancel</Trans>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
