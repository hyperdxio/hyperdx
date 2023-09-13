import { getLogLevelClass } from './utils';

export default function LogLevel({ level }: { level: string }) {
  const lvlClass = getLogLevelClass(level);

  const colorClass =
    lvlClass === 'error'
      ? 'text-danger'
      : lvlClass === 'warn'
      ? 'text-warning'
      : 'text-muted';
  return <span className={colorClass}>{level}</span>;
}
