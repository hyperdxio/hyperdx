import { expect, Page } from '@playwright/test';

/**
 * Interface for user registration data
 */
export interface RegistrationData {
  email: string;
  password: string;
  name: string;
}

/**
 * Fills in the registration form with the provided user data
 * @param page - Playwright page object
 * @param userData - User registration data
 */
export async function fillRegistrationForm(
  page: Page, 
  userData: RegistrationData
): Promise<void> {
  await page.fill('input[name="email"]', userData.email);
  await page.fill('input[name="password"]', userData.password);
  await page.fill('input[name="confirmPassword"]', userData.password);
}

/**
 * Generates random registration data for testing
 * @returns Registration data with random values
 */
export function generateTestUser(): RegistrationData {
  return {
    email: `test-${Date.now()}@example.com`,
    password: 'TestPassword123!',
    name: 'Test User',
  };
}

/**
 * Registers a new user in the HyperDX application
 * @param page - Playwright page object
 * @param userData - User data for registration (optional, will generate random data if not provided)
 * @returns Promise resolving to the registered user data
 */
export async function register(
  page: Page,
  userData?: Partial<RegistrationData>
): Promise<RegistrationData> {
  // Generate random test user data and merge with any provided data
  const testUser = {
    ...generateTestUser(),
    ...userData,
  };
  
  // Navigate to the registration page
  await page.goto('http://localhost:8080/register');
  
  // Close any potential devtools that might be open
  try {
    await page.click('[aria-label="Close tanstack query devtools"]', { timeout: 1000 });
  } catch (error) {
    // Ignore if the element isn't found
  }
  
  // Fill in the registration form
  await fillRegistrationForm(page, testUser);
  
  // Submit the registration form
  await page.click('button[type="submit"]');
  
  // Wait for registration to complete and redirect
  await page.waitForURL(/http:\/\/localhost:8080\/(search|dashboard|welcome)/, {
    timeout: 10000,
  });
  
  // Store the authentication state
  await page.context().storageState({ path: 'auth.json' });
  
  // Return the registered user details
  return testUser;
}

/**
 * Sets up demo sources after registration
 * @param page - Playwright page object
 */
export async function setupDemoSources(page: Page): Promise<void> {
  // Find the "Connect to Demo Server" button
  const demoButton = page.locator('[data-testid="connect-demo-server"]');
  await expect(demoButton).toBeVisible({ timeout: 10000 });

  // Click the button to set up demo sources
  await demoButton.click();

  // Wait for success notification
  const notification = page.locator('.mantine-Notification-root:has-text("Success")');
  await expect(notification).toBeVisible({ timeout: 20000 });
  await expect(notification).toContainText('Connected to HyperDX demo server');

  // Verify the modal has closed
  await expect(page.locator('.mantine-Modal-root')).not.toBeVisible({ timeout: 5000 });
}

/**
 * Sets up a custom connection and log source
 * @param page - Playwright page object
 * @param connectionName - Name for the connection
 * @param sourceName - Name for the source
 */
export async function setupCustomSource(
  page: Page,
  connectionName: string = 'Test Connection',
  sourceName: string = 'Test Logs'
): Promise<void> {
  // Wait for the connection form
  const connectionNameInput = page.locator('input[name="name"]');
  await expect(connectionNameInput).toBeVisible({ timeout: 10000 });

  // Fill connection form
  await connectionNameInput.fill(connectionName);
  await page.locator('input[name="host"]').fill('http://localhost:8123');
  await page.locator('input[name="username"]').fill('default');
  await page.locator('input[name="password"]').fill('');

  // Submit connection form
  await page.locator('button:has-text("Save Connection")').click();

  // Now we should be at the source setup step
  await expect(page.locator('text=Lets set up a source table')).toBeVisible({ timeout: 5000 });

  // Fill out source form
  await page.locator('input[name="name"]').fill(sourceName);

  // Select Log as the source data type
  await page.locator('input[value="log"]').check();

  // Fill out required fields for the log source
  await page.locator('input[name="from.databaseName"]').fill('default');
  await page.locator('input[name="from.tableName"]').fill('otel_logs');
  
  // Fill out timestamp expression
  const timestampInput = page.locator('textarea[name="timestampValueExpression"]');
  await timestampInput.fill('Timestamp');

  // Fill out default table select expression
  const defaultSelectInput = page.locator('textarea[name="defaultTableSelectExpression"]');
  await defaultSelectInput.fill('Timestamp, Body');

  // Submit source form
  await page.locator('button:has-text("Save New Source")').click();

  // Wait for success notification
  const notification = page.locator('.mantine-Notification-root:has-text("Source created")');
  await expect(notification).toBeVisible({ timeout: 10000 });

  // Verify the modal has closed
  await expect(page.locator('.mantine-Modal-root')).not.toBeVisible({ timeout: 5000 });
}

export default register;