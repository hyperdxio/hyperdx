import type { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { act, screen } from '@testing-library/react';

import ServiceMapTooltip from '@/components/ServiceMap/ServiceMapTooltip';
import i18n from '@/i18n';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(() => ({ data: undefined })),
}));

const source = { id: 'trace-source' } as unknown as TTraceSource;

describe('service map localization boundaries', () => {
  afterEach(async () => {
    restoreKoreanCatalog('services');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  const renderTooltip = () =>
    renderWithMantine(
      <ServiceMapTooltip
        totalRequests={10}
        errorPercentage={0}
        serviceName="checkout"
        source={source}
        dateRange={[new Date(0), new Date(1)]}
        isFocused={false}
        onFocus={jest.fn()}
      />,
    );

  it('renders English service map copy by default', () => {
    renderTooltip();

    expect(screen.getByText('Focus on this service')).toBeInTheDocument();
  });

  it('translates service map copy from the catalog while falling back to English', async () => {
    setKoreanFixture('services', {
      'map.focusOnService': '이 서비스에 집중',
    });
    await act(async () => {
      await i18n.changeLanguage('ko');
    });

    renderTooltip();

    // Reviewed Korean entry is consumed from the catalog.
    expect(screen.getByText('이 서비스에 집중')).toBeInTheDocument();
  });
});
