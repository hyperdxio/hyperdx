import React from 'react';
import cx from 'classnames';
import { UnstyledButton } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

import styles from '../../../styles/LogTable.module.scss';

export interface DBRowTableIconButtonProps {
  onClick: (e: React.MouseEvent) => void;
  className?: string;
  title?: string;
  tabIndex?: number;
  children: React.ReactNode;
  variant?: 'copy' | 'default';
  isActive?: boolean;
  iconSize?: number;
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
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClick(e);
  };

  const baseClasses =
    variant === 'copy'
      ? cx('text-muted-hover', styles.iconActionButton, {
          [styles.copied]: isActive,
        })
      : className;

  return (
    <UnstyledButton
      onClick={handleClick}
      className={baseClasses}
      title={title}
      tabIndex={tabIndex}
    >
      {isActive ? <IconCheck size={iconSize} /> : children}
    </UnstyledButton>
  );
};

export default DBRowTableIconButton;
