// Common test utilities
export class TestUtils {
  private static onboardingHandled = new Set<string>();

  // Helper to handle the "Welcome to HyperDX" onboarding modal
  static async handleOnboardingModal(page: any) {
    const pageId = page.context().pages().indexOf(page).toString();

    // Skip if onboarding already handled for this page context
    if (this.onboardingHandled.has(pageId)) {
      return false;
    }

    try {
      const connectToDemoButton = page
        .locator('[data-testid="demo-server-button"]')
        .first();

      await connectToDemoButton.waitFor({ state: 'visible', timeout: 5000 });
      await connectToDemoButton.click({ force: true });

      // Mark onboarding as handled for this page context
      this.onboardingHandled.add(pageId);
      return true;
    } catch (e) {
      // Only log if we haven't already handled onboarding
      if (!this.onboardingHandled.has(pageId)) {
        console.log('Error in handleOnboardingModal:', e.message);
      }
      return false;
    }
  }
}
