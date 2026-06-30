import { memo, useEffect } from 'react';
import { useRouter } from 'next/router';

import { useConnections } from '@/connection';
import { useSources } from '@/source';

/**
 * Redirects users who still need to finish onboarding to the getting-started
 * page. Replaces the old blocking `OnboardingModal`: instead of overlaying a
 * non-dismissible modal on every feature page, we send the user to the
 * dedicated `/getting-started` page when there's no connection (or no source,
 * when the page requires one).
 *
 * Renders nothing.
 */
function OnboardingGateComponent({
  requireSource = true,
}: {
  requireSource?: boolean;
}) {
  const router = useRouter();
  const { data: connections } = useConnections();
  const { data: sources } = useSources();

  // Only decide once the relevant queries have resolved, so we don't redirect
  // on the initial loading frame.
  const needsConnection = connections != null && connections.length === 0;
  const needsSource =
    requireSource &&
    connections != null &&
    connections.length > 0 &&
    sources != null &&
    sources.length === 0;

  const needsOnboarding = needsConnection || needsSource;

  useEffect(() => {
    if (needsOnboarding && router.pathname !== '/getting-started') {
      router.replace('/getting-started');
    }
  }, [needsOnboarding, router]);

  return null;
}

const OnboardingGate = memo(OnboardingGateComponent);
export default OnboardingGate;
