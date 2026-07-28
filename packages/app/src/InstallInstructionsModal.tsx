import cx from 'classnames';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('common');

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
              {isCopied ? t('actions.copied') : t('actions.copy')}
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
  const { t } = useTranslation('navigation');
  const { data: team } = api.useTeam();

  return (
    <Modal
      opened={show}
      onClose={onHide}
      title={t('install.title')}
      size="lg"
      centered
    >
      <div className="inter">
        {team != null && (
          <div className="mb-4">
            <CopyableValue
              label={
                <span className="text-muted me-2">{t('install.apiKey')} </span>
              }
              value={team.apiKey}
            />
          </div>
        )}
        <div className="fs-7 mb-4">{t('install.instructions')}</div>
        <div className="fs-6 mb-2">{t('install.backend')}</div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/nodejs"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Node.js
          </a>
          <span className="ms-2 text-muted">{t('install.logsAndTraces')}</span>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/golang"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Go
          </a>
          <span className="ms-2 text-muted">{t('install.logsAndTraces')}</span>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/python"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Python
          </a>
          <span className="ms-2 text-muted">{t('install.logsAndTraces')}</span>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/java"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Java
          </a>
          <span className="ms-2 text-muted">{t('install.logsAndTraces')}</span>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/elixir"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Elixir
          </a>
          <span className="ms-2 text-muted">{t('install.logs')}</span>
        </div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/ruby-on-rails"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Ruby on Rails
          </a>
          <span className="ms-2 text-muted">{t('install.traces')}</span>
        </div>
        <div className="fs-6 mb-2 mt-4">{t('install.platform')}</div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/kubernetes"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Kubernetes
          </a>
          <span className="ms-2 text-muted">{t('install.logsAndMetrics')}</span>
        </div>
        <div className="fs-6 mb-2 mt-4">{t('install.browser')}</div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/browser"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            JavaScript/TypeScript
          </a>
          <span className="ms-2 text-muted">{t('install.logsAndTraces')}</span>
        </div>
        <div className="fs-6 mb-2 mt-4">{t('install.dataCollector')}</div>
        <div className="mb-2">
          <a
            href="https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/opentelemetry#sending-otel-data"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            OpenTelemetry
          </a>
          <span className="ms-2 text-muted">{t('install.logsAndTraces')}</span>
        </div>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => onHide()}>
            {t('actions.cancel', { ns: 'common' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
