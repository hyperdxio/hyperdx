import { useEffect } from 'react';
import Router from 'next/router';

import api from '@/api';

export default function IndexPage() {
  const { data: me, isLoading } = api.useMe();

  useEffect(() => {
    if (isLoading) return;
    if (me) {
      Router.replace('/catalog');
    } else {
      Router.replace('/login');
    }
  }, [isLoading, me]);

  return null;
}
