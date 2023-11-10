import { useEffect } from 'react';

/**
 * By default, clicking outside of the drawer will close it.
 * If you want to prevent this, add the `data-keep-drawer-open` attribute to the
 * element you want to keep the drawer open (such as Log Table and the drawer itself).
 */
export const KEEP_DRAWER_OPEN_DATA_ATTRIBUTE = 'data-keep-drawer-open';

export const useDrawerWithInteractiveBg = ({
  disabled,
  onClose,
}: {
  disabled: boolean;
  onClose: VoidFunction;
}) => {
  useEffect(() => {
    const windowClickHandler = (e: MouseEvent) => {
      if (e.target instanceof Element) {
        const keepDrawerOpen = e.target.closest(
          `[${KEEP_DRAWER_OPEN_DATA_ATTRIBUTE}]`,
        );
        if (!keepDrawerOpen) {
          onClose();
        }
      }
    };

    if (!disabled) {
      window.addEventListener('click', windowClickHandler);
    }

    return () => {
      window.removeEventListener('click', windowClickHandler);
    };
  }, [disabled, onClose]);
};
