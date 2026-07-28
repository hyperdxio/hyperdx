import { act, screen } from '@testing-library/react';

import { FormatPodStatus } from '@/components/KubeComponents';
import i18n from '@/i18n';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';
import { KubePhase } from '@/types';

describe('infrastructure localization boundaries', () => {
  afterEach(async () => {
    restoreKoreanCatalog('infrastructure');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders English pod status copy by default', () => {
    renderWithMantine(<FormatPodStatus status={KubePhase.Running} />);

    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('translates pod status copy from the catalog while falling back to English', async () => {
    setKoreanFixture('infrastructure', {
      'kubernetes.pods.phaseRunning': '실행 중',
    });
    await act(async () => {
      await i18n.changeLanguage('ko');
    });

    renderWithMantine(
      <>
        <FormatPodStatus status={KubePhase.Running} />
        <FormatPodStatus status={KubePhase.Failed} />
      </>,
    );

    // Reviewed Korean entry is consumed from the catalog.
    expect(screen.getByText('실행 중')).toBeInTheDocument();

    // Untranslated entries fall back to English rather than showing a key.
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
