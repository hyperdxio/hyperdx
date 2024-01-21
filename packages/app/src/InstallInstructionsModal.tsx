import cx from 'classnames';
import { Button, Modal } from 'react-bootstrap';

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
    <Clipboard text={value} className="d-block mx-auto p-0 w-100">
      {({ isCopied }) => {
        return (
          <div
            className={cx(
              'd-flex fs-6 py-2 px-3 bg-grey rounded align-items-center justify-content-between cursor-pointer text-white-hover',
              {
                'text-success': isCopied,
              },
            )}
          >
            <div className="fs-7 d-flex text-truncate align-items-center">
              {label}
              <pre className="mb-0 user-select-all d-inline text-truncate fs-7 lh-1">
                {value}
              </pre>
            </div>
            <div className={cx('fs-7 text-end text-nowrap')}>
              <i
                className={cx('bi me-2', {
                  'bi-clipboard': !isCopied,
                  'bi-clipboard-check': isCopied,
                })}
              ></i>
              {isCopied ? 'Copied to Clipboard!' : 'Copy'}
            </div>
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
  const { data: team, isLoading, refetch: refetchTeam } = api.useTeam();

  return (
    <Modal
      aria-labelledby="contained-modal-title-vcenter"
      centered
      onHide={onHide}
      show={show}
      size="lg"
    >
      <Modal.Body className="bg-hdx-dark rounded">
        <div className="fs-4 mb-4">Install HyperDX</div>
        {team != null && (
          <div className="mb-4">
            <CopyableValue
              label={<span className="text-muted me-2">Your API Key: </span>}
              value={team.apiKey}
            />
          </div>
        )}
        <div className="fs-7 mb-4">
          Click on a link below to view installation instructions for your
          application.
        </div>
        <div className="fs-5 mb-2">Backend</div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/javascript"
            target="_blank"
            rel="noreferrer"
          >
            Node.js
          </a>
          <span className="ms-2 text-muted">(Logs + Traces)</span>
        </div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/golang"
            target="_blank"
            rel="noreferrer"
          >
            Go
          </a>
          <span className="ms-2 text-muted">(Logs + Traces)</span>
        </div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/python"
            target="_blank"
            rel="noreferrer"
          >
            Python
          </a>
          <span className="ms-2 text-muted">(Logs + Traces)</span>
        </div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/java"
            target="_blank"
            rel="noreferrer"
          >
            Java
          </a>
          <span className="ms-2 text-muted">(Logs + Traces)</span>
        </div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/elixir"
            target="_blank"
            rel="noreferrer"
          >
            Elixir
          </a>
          <span className="ms-2 text-muted">(Logs)</span>
        </div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/ruby"
            target="_blank"
            rel="noreferrer"
          >
            Ruby on Rails
          </a>
          <span className="ms-2 text-muted">(Traces)</span>
        </div>
        <div className="fs-5 mb-2 mt-4">Platform</div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/fly"
            target="_blank"
            rel="noreferrer"
          >
            Fly.io
          </a>
          <span className="ms-2 text-muted">(Logs)</span>
        </div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/cloudflare"
            target="_blank"
            rel="noreferrer"
          >
            Cloudflare Workers
          </a>
          <span className="ms-2 text-muted">(Logs + Traces)</span>
        </div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/kubernetes"
            target="_blank"
            rel="noreferrer"
          >
            Kubernetes
          </a>
          <span className="ms-2 text-muted">(Logs + Metrics)</span>
        </div>
        <div className="fs-5 mb-2 mt-4">Browser</div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/browser"
            target="_blank"
            rel="noreferrer"
          >
            JavaScript/TypeScript
          </a>
          <span className="ms-2 text-muted">(Logs + Traces)</span>
        </div>
        <div className="fs-5 mb-2 mt-4">Data Collector</div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/opentelemetry"
            target="_blank"
            rel="noreferrer"
          >
            OpenTelemetry
          </a>
          <span className="ms-2 text-muted">(Logs + Traces)</span>
        </div>
        <div className="fs-6 mb-2">
          <a
            href="https://hyperdx.io/docs/install/fluentd"
            target="_blank"
            rel="noreferrer"
          >
            Fluentd
          </a>
          <span className="ms-2 text-muted">(Logs)</span>
        </div>
        <div className="mt-4">
          <Button variant="dark" onClick={() => onHide()}>
            Cancel
          </Button>
        </div>
      </Modal.Body>
    </Modal>
  );
}
