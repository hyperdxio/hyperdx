import * as React from 'react';
import Head from 'next/head';
import { Container } from '@mantine/core';

import { PageHeader } from '@/components/PageHeader';

import { withAppNav } from './layout';

export default function SessionsPage() {
  return (
    <div>
      <Head>
        <title>Client Sessions - HyperDX</title>
      </Head>
      <PageHeader>Client Sessions</PageHeader>
      <div className="my-4">
        <Container maw={1500}>
          <div>WIP</div>
        </Container>
      </div>
    </div>
  );
}

SessionsPage.getLayout = withAppNav;
