import React from 'react';
import { Card, Text, UnstyledButton } from '@mantine/core';
import { IconArrowRight, IconRocket } from '@tabler/icons-react';

import styles from './GettingStarted.module.scss';

export interface DemoBannerProps {
  onClick?: () => void;
}

export const DemoBanner: React.FC<DemoBannerProps> = ({ onClick }) => (
  <UnstyledButton onClick={onClick} className={styles.demoBannerButton}>
    <Card withBorder p="md" radius="sm" className={styles.demoBanner}>
      <div className={styles.demoBannerIcon}>
        <IconRocket size={24} />
      </div>
      <div className={styles.demoBannerContent}>
        <Text size="sm" fw={600} className={styles.demoBannerTitle}>
          Want to see it in action first?
        </Text>
        <Text size="sm" c="dimmed">
          Skip the setup and explore a live demo project
        </Text>
      </div>
      <IconArrowRight size={24} className={styles.demoBannerArrow} />
    </Card>
  </UnstyledButton>
);
