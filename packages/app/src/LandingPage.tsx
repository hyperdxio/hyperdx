import { useEffect } from 'react';
import { useRouter } from 'next/router';

import api from './api';
import AuthLoadingBlocker from './AuthLoadingBlocker';

export default function LandingPage() {
  const { data: installation, isLoading: installationIsLoading } =
    api.useInstallation();
  const { data: team, isLoading: teamIsLoading } = api.useTeam();
  const router = useRouter();

  const isLoggedIn = Boolean(!teamIsLoading && team);

  useEffect(() => {
    if (isLoggedIn) {
      router.push('/search');
    }
  }, [isLoggedIn, router]);

  useEffect(() => {
    if (installation?.isTeamExisting === true) {
      router.push('/login');
    } else if (installation?.isTeamExisting === false) {
      router.push('/register');
    }
  }, [installation, router]);

  return <AuthLoadingBlocker />;
}
