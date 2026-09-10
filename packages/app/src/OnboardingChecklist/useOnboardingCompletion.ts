import { useEffect, useMemo, useRef, useState } from 'react';

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
// The setup phase is offered to teams younger than this; the product-usage
// phase to teams younger than the (larger) product window.
const SETUP_MAX_TEAM_AGE_DAYS = 3;
const PRODUCT_MAX_TEAM_AGE_DAYS = 7;

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
  // Brand-aware: a ClickStack deployment must never render "HyperDX".
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

  // Age-gate the checklist so it only greets recently-created teams, not every
  // long-established install. Two windows: the setup phase (connect ClickHouse,
  // add data) is offered for the first SETUP_MAX_TEAM_AGE_DAYS, and the
  // product-usage phase for the (longer) PRODUCT_MAX_TEAM_AGE_DAYS — a team
  // still finishing setup on day 4 shouldn't see it, but a set-up team still has
  // a few days to be nudged through first real usage.
  const teamAgeDays =
    team?.createdAt == null
      ? null
      : (NOW - new Date(team.createdAt).getTime()) / DAY_MS;

  const hasConnections = (connections?.length ?? 0) > 0;
  const hasSources = (sources?.length ?? 0) > 0;

  const firstConnection = connections?.[0];
  const firstConnectionSources = useMemo(
    () => sources?.filter(source => source.connection === firstConnection?.id),
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
  // The row-count query decides the setup phase's "Add data" step AND, by
  // extension, whether setup is complete (which gates the product phase). Gate
  // it so it never fires when NO checklist phase could render — otherwise every
  // user, on every app load and window refocus, runs `sum(total_rows) FROM
  // system.tables` (react-query's defaults refetch on focus). It runs only for
  // a real signed-in user (not IS_LOCAL_MODE, where `me` is null), a team inside
  // the outer (product) age window, with a connection, and not dismissed —
  // i.e. teams older than PRODUCT_MAX_TEAM_AGE_DAYS never touch system.tables.
  const isWithinAnyOnboardingWindow =
    me != null &&
    teamAgeDays != null &&
    teamAgeDays < PRODUCT_MAX_TEAM_AGE_DAYS &&
    !onboardingData?.isDismissed;
  const { data: sourceRowsData, isLoading: isSourceRowsLoading } =
    useQueriedChartConfig(sourceRowsConfig, {
      // Also guards against firing with `connection: ''`, which fails Zod
      // validation on the API's clickhouse-proxy.
      enabled: !!firstConnection?.id && isWithinAnyOnboardingWindow,
    });
  const hasData = sourceRowsData?.data?.[0]?.total_rows > 0;

  // Phase 1: setup steps, detected by reading team state.
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

  // Phase 2: product-usage tasks, persisted per user. Only surfaced once the
  // setup phase is done — setup first, then getting started using the product.
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

  // Per-phase age gate: the setup phase closes after SETUP_MAX_TEAM_AGE_DAYS,
  // the product phase after the longer PRODUCT_MAX_TEAM_AGE_DAYS. `null` age
  // (team not loaded yet, or local mode with no team) is not eligible.
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
  // The first not-yet-complete step is the "active" one — highlighted like a
  // call-to-action in the mockup.
  const activeStepId = steps.find(step => !step.isComplete)?.id;

  // "Done" is DERIVED from whether every current task is complete — we never
  // persist a "completed" flag. This is deliberate: adding or changing a task
  // in ONBOARDING_TASK_IDS later leaves a previously-finished user with an
  // unmet task, so the checklist reappears on its own. (isDismissed is only for
  // the manual X, when a user opts out early.)
  const allTasksComplete = isSetupComplete && isPhaseComplete;

  // Every input that feeds `allTasksComplete` must be settled before we trust
  // it. If we latched on `me` alone, the setup queries (connections/sources/
  // row-count) could still be loading — making tasks look incomplete for a
  // beat, then flipping to complete once they resolve, which reads as an
  // "in-session completion" and wrongly shows + celebrates on load.
  // The row-count query is disabled until there's a connection to query; a
  // disabled query reports isLoading:true forever, so only wait on it when it's
  // actually enabled (i.e. a connection exists).
  const sourceRowsSettled = !firstConnection?.id || !isSourceRowsLoading;
  const inputsReady =
    !isMeLoading &&
    me != null &&
    onboardingData != null &&
    !isTeamLoading &&
    !isConnectionsLoading &&
    !isSourcesLoading &&
    sourceRowsSettled;

  // Only celebrate for a completion that happens IN THIS SESSION. Latch the
  // completion state the first time all inputs are ready: if the user was
  // already done on arrival, that's past work — hide, no celebration. If they
  // finish while the card is open, hold it up briefly to celebrate.
  const [celebrationDone, setCelebrationDone] = useState(false);
  const [wasCompleteOnLoad, setWasCompleteOnLoad] = useState<boolean | null>(
    null,
  );

  // Read the latest completion state inside the latch effect without making it
  // a dependency: the effect must run only when `inputsReady` flips, and
  // `allTasksComplete` merely seeds the initial value. A ref keeps deps
  // exhaustive without re-latching on every completion change.
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

  // Don't render until inputs are ready and we've latched the load-time state —
  // otherwise we'd flash the card during the setup-query load. Then hide when
  // dismissed, or once all current tasks are complete (after any in-session
  // celebration).
  const shouldShow =
    inputsReady &&
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
