import dotenv from 'dotenv';
import path from 'path';
import { Page } from "@playwright/test";

const envPath = path.resolve(__dirname, '../.playwright.env');

const result = dotenv.config({ path: envPath });

async function login(page: Page) {
    if (!process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD) {
        throw new Error('Missing required environment variables for login');
    }

    await page.goto('http://localhost:8080/login');
    await page.fill('input[name="email"]', process.env.TEST_USER_EMAIL);
    await page.fill('input[name="password"]', process.env.TEST_USER_PASSWORD);
    await page.click('[aria-label="Close tanstack query devtools"]');
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
  }

export default login;