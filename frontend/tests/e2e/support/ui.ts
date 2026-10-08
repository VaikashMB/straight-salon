import { expect, type Page } from '@playwright/test';
import { PASSWORD } from './api';

/** Signs in through the login page and waits for the role's landing area (05 §5). */
export async function signIn(page: Page, email: string, landing: RegExp): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(landing);
}

/** Minor units from a formatted amount such as "₹1,234.50" (two-decimal currencies). */
export function moneyToMinor(text: string): number {
  return Math.round(Number(text.replace(/[^\d.]/g, '')) * 100);
}
