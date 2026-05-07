import React from 'react';
import cx from 'classnames';
import { Tooltip, UnstyledButton } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

import styles from '../../../styles/LogTable.module.scss';

interface DBRowTableIconButtonProps {
  onClick: (e: React.MouseEvent) => void;
  className?: string;
  title?: string;
  tabIndex?: number;
  children: React.ReactNode;
  variant?: 'copy' | 'default';
  isActive?: boolean;
  iconSize?: number;
  'data-testid'?: string;
}

export const DBRowTableIconButton: React.FC<DBRowTableIconButtonProps> = ({
  onClick,
  className,
  title,
  tabIndex = -1,
  children,
  variant = 'default',
  isActive = false,
  iconSize = 14,
  'data-testid': dataTestId,
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClick(e);
  };

  const baseClasses =
    variant === 'copy'
      ? cx(styles.iconActionButton, {
          [styles.copied]: isActive,
        })
      : className;

  return (
    <Tooltip
      label={title}
      position="top"
      withArrow
      disabled={!title}
      openDelay={300}
      closeDelay={100}
      fz="xs"
    >
      <UnstyledButton
        onClick={handleClick}
        component="div"
        className={baseClasses}
        tabIndex={tabIndex}
        role="button"
        data-testid={dataTestId}
      >
        {isActive ? <IconCheck size={iconSize} /> : children}
      </UnstyledButton>
    </Tooltip>
  );
};
