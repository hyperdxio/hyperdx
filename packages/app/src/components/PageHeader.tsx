import styles from './PageHeader.module.scss';

export const PageHeader = ({ children }: { children: React.ReactNode }) => {
  return <div className={styles.header}> {children}</div>;
};
