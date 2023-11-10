import styles from '../styles/LogSidePanel.module.scss';
import { CloseButton } from 'react-bootstrap';
import { useLocalStorage } from './utils';
import * as React from 'react';

const Kbd = ({ children }: { children: string }) => (
  <div className={styles.kbd}>{children}</div>
);

export default function LogSidePanelKbdShortcuts() {
  const [isDismissed, setDismissed] = useLocalStorage<boolean>(
    'kbd-shortcuts-dismissed',
    false,
  );

  const handleDismiss = React.useCallback(() => {
    setDismissed(true);
  }, []);

  if (isDismissed) {
    return null;
  }

  return (
    <div className={styles.kbdShortcuts}>
      <div className="d-flex justify-content-between align-items-center ">
        <div className="d-flex align-items-center gap-3">
          <div>
            Use <Kbd>←</Kbd>
            <Kbd>→</Kbd> arrow keys to move through events
          </div>
          <div className={styles.kbdDivider} />
          <div>
            <Kbd>ESC</Kbd> to close
          </div>
        </div>
        <CloseButton
          variant="white"
          aria-label="Hide"
          onClick={handleDismiss}
        />
      </div>
    </div>
  );
}
