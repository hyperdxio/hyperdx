import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function SavedSearchesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace({
      pathname: '/search',
      query: { panel: 'saved-searches' },
    });
  }, [router]);

  return null;
}
