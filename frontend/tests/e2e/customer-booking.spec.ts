import { expect, test } from '@playwright/test';
import { uniqueId, uniquePhone } from './support/api';

// 05 §9: register → book → see in account → cancel (US-01, US-02). Runs on desktop and on a
// Pixel 7 viewport (05 §2: the booking flow must work one-handed on a phone).

const BOOKING_REF = /SS-\d{6}-[A-Z0-9]{4}/;
const DAY_BUTTON = /^\w+day \d{1,2} \w+ \d{4}$/; // e.g. "Friday 9 October 2026"

test('a new customer registers, books, sees the booking in their account and cancels it', async ({
  page,
}) => {
  const id = uniqueId();

  await test.step('register (API-001)', async () => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill(`E2E Customer ${id}`);
    await page.getByLabel('Email').fill(`e2e-${id}@example.com`);
    // Typed without the calling code: the form adds +91 (05 §8).
    await page.getByLabel('Mobile number').fill(uniquePhone().slice(3));
    await page.getByLabel('Password').fill('Booking2go!');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/account$/);
  });

  let ref = '';
  await test.step('book through the wizard (05 §4.1)', async () => {
    await page.goto('/book');
    await expect(page.getByRole('heading', { name: 'Choose your services' })).toBeVisible();
    await page.getByRole('button', { name: /^Beard Trim/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Choose a stylist' })).toBeVisible();
    await page.getByRole('radio', { name: /Any available/ }).click();

    await expect(page.getByRole('heading', { name: 'Pick a date and time' })).toBeVisible();
    // The second bookable day: its first slot is always more than the 2 h cancellation
    // cut-off away (BR-006), whatever the time of day, so the booking stays cancellable.
    const days = page.getByRole('button', { name: DAY_BUTTON, disabled: false });
    await expect(days.nth(1)).toBeVisible();
    await days.nth(1).click();
    await page
      .getByRole('group', { name: /Morning|Afternoon|Evening/ })
      .getByRole('button')
      .first()
      .click();

    await expect(page.getByRole('heading', { name: 'Review and confirm' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByRole('heading', { name: "You're booked!" })).toBeVisible();
    ref = (await page.getByText(BOOKING_REF).first().textContent())?.match(BOOKING_REF)?.[0] ?? '';
    expect(ref).toMatch(BOOKING_REF);
  });

  await test.step('see it in upcoming bookings (FR-036)', async () => {
    await page.getByRole('main').getByRole('link', { name: 'My bookings' }).click();
    await expect(page).toHaveURL(/\/account$/);
    const card = page.getByRole('article').filter({ hasText: ref });
    await expect(card).toContainText('Booked');
    await expect(card).toContainText('Beard Trim');
  });

  await test.step('cancel it (FR-035)', async () => {
    const card = page.getByRole('article').filter({ hasText: ref });
    await card.getByRole('button', { name: 'Cancel' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this booking?' });
    await dialog.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('article').filter({ hasText: ref })).toHaveCount(0);

    await page.goto('/account/history');
    await expect(page.getByRole('article').filter({ hasText: ref })).toContainText('Cancelled');
  });
});
