import React from 'react';
import { IconCheck } from '@tabler/icons-react';

import styles from './GettingStarted.module.scss';

export interface StepProps {
  number: number;
  title: string;
  description?: React.ReactNode;
  isActive?: boolean;
  isCompleted?: boolean;
  isLast?: boolean;
  children?: React.ReactNode;
}

export const Step: React.FC<StepProps> = ({
  number,
  title,
  description,
  isActive = false,
  isCompleted = false,
  isLast = false,
  children,
}) => {
  return (
    <div className={styles.step}>
      <div className={styles.stepRow}>
        {/* Step number circle */}
        <div className={styles.stepIndicator}>
          <div
            className={`${styles.stepNumber} ${
              isCompleted
                ? styles.stepNumberCompleted
                : isActive
                  ? styles.stepNumberActive
                  : styles.stepNumberInactive
            }`}
          >
            {isCompleted ? <IconCheck size={12} stroke={2.5} /> : number}
          </div>
          {/* Connector line */}
          {!isLast && (
            <div className={styles.connector}>
              <div
                className={`${styles.connectorLine} ${isCompleted ? styles.connectorLineCompleted : ''}`}
              />
            </div>
          )}
        </div>

        {/* Step content */}
        <div className={styles.stepBody}>
          <div
            className={`${styles.stepTitle} ${
              isCompleted
                ? styles.stepTitleCompleted
                : !isActive
                  ? styles.stepTitleInactive
                  : ''
            }`}
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
