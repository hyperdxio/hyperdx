import { act, screen } from '@testing-library/react';

import { CopySnippet } from '@/components/ClickStackOnboarding/CopySnippet';
import { DeeplinkInstall } from '@/components/ClickStackOnboarding/DeeplinkInstall';
import i18n from '@/i18n';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';

describe('onboarding localization boundaries', () => {
  afterEach(async () => {
    restoreKoreanCatalog('onboarding');
    restoreKoreanCatalog('common');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  const renderInstall = () =>
    renderWithMantine(
      <>
        <DeeplinkInstall
          buttonLabel="Add to Cursor"
          deeplink="cursor://install"
          fallbackLabel="Fallback"
          fallbackSnippet="{}"
        />
        <CopySnippet label="Snippet" snippet="{}" />
      </>,
    );

  it('renders English onboarding copy by default', () => {
    renderInstall();

    expect(screen.getByText('Manual setup')).toBeInTheDocument();
    expect(screen.getAllByText('Copy').length).toBeGreaterThan(0);
  });

  it('translates onboarding copy from the catalog while falling back to English', async () => {
    setKoreanFixture('onboarding', {
      'mcp.manualSetup': '수동 설정',
    });
    // The copy button reads from `common`; leaving that namespace without a
    // reviewed entry keeps the English fallback assertion below meaningful.
    setKoreanFixture('common', {});
    await act(async () => {
      await i18n.changeLanguage('ko');
    });

    renderInstall();

    // Reviewed Korean entry is consumed from the catalog.
    expect(screen.getByText('수동 설정')).toBeInTheDocument();

    // Untranslated entries fall back to English rather than showing a key.
    expect(screen.getAllByText('Copy').length).toBeGreaterThan(0);
  });
});
