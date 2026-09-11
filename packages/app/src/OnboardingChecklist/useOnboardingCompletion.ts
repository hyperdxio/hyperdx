import { useEffect, useMemo, useRef, useState } from 'react';
import { isPersistableUserId } from '@hyperdx/common-utils/dist/types';

import api from '@/api';
import { NOW } from '@/config';
import { useConnections } from '@/connection';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useSources } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

import {
  OnboardingStep,
  PRODUCT_TASK_ORDER,
  PRODUCT_TASKS,
} from './onboardingTasks';

const DAY_MS = 1000 * 60 * 60 * 24;
// Setup phase closes after 3 days, product-usage phase after 7.
const SETUP_MAX_TEAM_AGE_DAYS = 3;
const PRODUCT_MAX_TEAM_AGE_DAYS = 7;
const SETUP_ROW_COUNT_STALE_MS = 5 * 60 * 1000;

interface OnboardingCompletion {
  steps: OnboardingStep[];
  phaseLabel: string;
  completedCount: number;
  activeStepId?: string;
  isCelebrating: boolean;
  shouldShow: boolean;
  dismiss: () => void;
  isDismissing: boolean;
}

export function useOnboardingCompletion(
  onAddDataClick?: () => void,
): OnboardingCompletion {
  // A ClickStack deployment must never render "HyperDX".
  const brandName = useBrandDisplayName();
  const { data: me, isLoading: isMeLoading } = api.useMe();
  const { data: team, isLoading: isTeamLoading } = api.useTeam();
  const { data: connections, isLoading: isConnectionsLoading } =
    useConnections();
  const { data: sources, isLoading: isSourcesLoading } = useSources();
  const dismissOnboarding = api.useDismissOnboarding();

  const onboardingData = me?.onboardingData;
  const completedTasks = useMemo(
    () => new Set(onboardingData?.completedTasks ?? []),
    [onboardingData],
  );

  const teamAgeDays =
    team?.createdAt == null
      ? null
      : (NOW - new Date(team.createdAt).getTime()) / DAY_MS;

  const hasConnections = (connections?.length ?? 0) > 0;
  const hasSources = (sources?.length ?? 0) > 0;

  const firstConnection = connections?.[0];
  const firstConnectionSources = useMemo(
    () =>
      sources?.filter(
        source => source.connection === firstConnection?.id && !source.disabled,
      ),
    [sources, firstConnection],
  );

  const sourceRowsConfig = useMemo(
    () => ({
      select: 'sum(total_rows) as total_rows',
      from: {
        databaseName: 'system',
        tableName: 'tables',
      },
      where: '',
      filtersLogicalOperator: 'OR' as const,
      filters: (firstConnectionSources ?? []).map(source => ({
        type: 'sql' as const,
        condition: `table = '${source.from.tableName}' AND database = '${source.from.databaseName}'`,
      })),
      connection: firstConnection?.id ?? '',
    }),
    [firstConnectionSources, firstConnection],
  );
  // `me == null` in IS_LOCAL_MODE, so the probe is skipped there.
  const isWithinAnyOnboardingWindow =
    me != null &&
    teamAgeDays != null &&
    teamAgeDays < PRODUCT_MAX_TEAM_AGE_DAYS &&
    !onboardingData?.isDismissed;
  // Empty `connection` fails clickhouse-proxy Zod validation; an empty filters
  // list (no enabled sources) would scan all of system.tables and wrongly count
  // unrelated tables as data.
  const isSourceRowsQueryEnabled =
    !!firstConnection?.id &&
    (firstConnectionSources?.length ?? 0) > 0 &&
    isWithinAnyOnboardingWindow;
  const { data: sourceRowsData, isLoading: isSourceRowsLoading } =
    useQueriedChartConfig(sourceRowsConfig, {
      enabled: isSourceRowsQueryEnabled,
      // Can't gate `enabled` on card visibility without circularity
      // (isSetupComplete needs hasData), so staleTime avoids refetch-on-focus
      // for in-window teams whose card is hidden.
      staleTime: SETUP_ROW_COUNT_STALE_MS,
    });
  const hasData = sourceRowsData?.data?.[0]?.total_rows > 0;

  const setupSteps: OnboardingStep[] = useMemo(
    () => [
      {
        id: 'connection',
        title: 'Connect to ClickHouse',
        description: 'Set up your database connection',
        isComplete: hasConnections,
        isLoading: isConnectionsLoading,
        href: hasConnections ? undefined : '/team',
      },
      {
        id: 'sources',
        title: 'Create data sources',
        description: 'Configure where your data comes from',
        isComplete: hasSources,
        isLoading: isSourcesLoading,
        href: hasSources ? undefined : '/team',
      },
      {
        id: 'data',
        title: 'Add data',
        description: 'Start sending logs, metrics, or traces',
        isComplete: hasData,
        isLoading: isSourceRowsLoading,
        onClick: hasData ? undefined : onAddDataClick,
      },
    ],
    [
      hasConnections,
      hasSources,
      hasData,
      isConnectionsLoading,
      isSourcesLoading,
      isSourceRowsLoading,
      onAddDataClick,
    ],
  );

  const isSetupComplete = setupSteps.every(step => step.isComplete);

  // Product-usage tasks are persisted per user, surfaced only after setup.
  const productSteps: OnboardingStep[] = useMemo(
    () =>
      PRODUCT_TASK_ORDER.map(id => ({
        id,
        title: PRODUCT_TASKS[id].title,
        description: PRODUCT_TASKS[id].description,
        href: PRODUCT_TASKS[id].href,
        isComplete: completedTasks.has(id),
      })),
    [completedTasks],
  );

  const isTeamAgeEligible =
    teamAgeDays != null &&
    teamAgeDays <
      (isSetupComplete ? PRODUCT_MAX_TEAM_AGE_DAYS : SETUP_MAX_TEAM_AGE_DAYS);

  const steps = isSetupComplete ? productSteps : setupSteps;
  const phaseLabel = isSetupComplete
    ? `Get started with ${brandName}`
    : 'Set up ClickHouse';
  const completedCount = steps.filter(step => step.isComplete).length;
  const isPhaseComplete = completedCount === steps.length;
  // First incomplete step; rendered as the active call-to-action.
  const activeStepId = steps.find(step => !step.isComplete)?.id;

  // Derived, never persisted: adding a task to ONBOARDING_TASK_IDS reopens the
  // checklist for previously-finished users. isDismissed is the manual opt-out.
  const allTasksComplete = isSetupComplete && isPhaseComplete;

  // Wait for every input feeding allTasksComplete before trusting it — else a
  // still-loading setup query flips complete mid-session and reads as an
  // in-session completion (wrongly showing + celebrating on load). A disabled
  // query reports isLoading forever, so only wait on the probe when enabled.
  const sourceRowsSettled = !isSourceRowsQueryEnabled || !isSourceRowsLoading;
  const inputsReady =
    !isMeLoading &&
    me != null &&
    onboardingData != null &&
    !isTeamLoading &&
    !isConnectionsLoading &&
    !isSourcesLoading &&
    sourceRowsSettled;

  // Celebrate only for an in-session completion: latch the load-time state once,
  // so a user already done on arrival sees nothing, but one who finishes while
  // the card is open gets a brief celebration.
  const [celebrationDone, setCelebrationDone] = useState(false);
  const [wasCompleteOnLoad, setWasCompleteOnLoad] = useState<boolean | null>(
    null,
  );

  // Ref so the latch effect reads the current value while depending only on
  // inputsReady — it must latch once, not re-run on every completion change.
  const allTasksCompleteRef = useRef(allTasksComplete);
  useEffect(() => {
    allTasksCompleteRef.current = allTasksComplete;
  }, [allTasksComplete]);

  useEffect(() => {
    if (inputsReady) {
      setWasCompleteOnLoad(prev =>
        prev === null ? allTasksCompleteRef.current : prev,
      );
    }
  }, [inputsReady]);

  const completedInSession = wasCompleteOnLoad === false && allTasksComplete;

  useEffect(() => {
    if (!completedInSession) {
      return;
    }
    const timer = setTimeout(() => setCelebrationDone(true), 4000);
    return () => clearTimeout(timer);
  }, [completedInSession]);

  const isCelebrating = completedInSession && !celebrationDone;

  // In the all-in-one-noauth image `me.id` is the synthetic `_local_user_`:
  // tasks never persist and dismiss no-ops, so hide the whole checklist there.
  const shouldShow =
    inputsReady &&
    isPersistableUserId(me.id) &&
    isTeamAgeEligible &&
    wasCompleteOnLoad !== null &&
    !onboardingData.isDismissed &&
    (!allTasksComplete || isCelebrating);

  return {
    steps,
    phaseLabel,
    completedCount,
    activeStepId,
    isCelebrating,
    shouldShow,
    dismiss: () => dismissOnboarding.mutate(true),
    isDismissing: dismissOnboarding.isPending,
  };
}
