import { expect, test, type Page } from '@playwright/test';
import {
  createBooking,
  createWalkIn,
  firstFreeSlot,
  login,
  SEED,
  services,
  setStatus,
  stylists,
  uniqueId,
} from './support/api';
import { moneyToMinor, signIn } from './support/ui';

// 05 §9: the receptionist records payment on a completed booking (FR-043), and the admin sees
// that revenue in the report for the booking's date (FR-071, US-05).

async function openReport(page: Page, date: string): Promise<void> {
  await page.goto('/admin/reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  // To first: From may not be after To, and To defaults to today.
  await page.getByLabel('To', { exact: true }).fill(date);
  await page.getByLabel('From', { exact: true }).fill(date);
}

async function revenue(page: Page): Promise<number> {
  const value = page
    .locator('div', { has: page.locator('dt', { hasText: /^Revenue$/ }) })
    .locator('dd');
  await expect(value.first()).toHaveText(/\d/);
  return moneyToMinor((await value.first().textContent()) ?? '');
}

test('the receptionist records a payment and the admin sees it in the report', async ({
  browser,
  request,
}) => {
  // A completed, unpaid booking on a later day, made through the API.
  const reception = await login(request, SEED.reception);
  const service = (await services(request))[0]!;
  const stylist = (await stylists(request, service.id))[0]!;
  const customer = await createWalkIn(request, reception, `E2e${uniqueId()} Payment`);
  const slot = await firstFreeSlot(request, reception, service.id, stylist.id);
  const booking = await createBooking(request, reception, {
    serviceId: service.id,
    staffId: stylist.id,
    startAt: slot.startAt,
    customerId: customer.id,
  });
  for (const status of ['CHECKED_IN', 'IN_SERVICE', 'COMPLETED'] as const) {
    await setStatus(request, reception, booking.id, status);
  }

  const adminContext = await browser.newContext();
  const receptionContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage();
    await signIn(admin, SEED.admin, /\/admin$/);
    await openReport(admin, slot.date);
    const before = await revenue(admin);

    await test.step('receptionist records the payment (API-057)', async () => {
      const desk = await receptionContext.newPage();
      await signIn(desk, SEED.reception, /\/admin$/);
      await desk.goto(`/admin/bookings/${booking.id}`);
      await expect(desk.getByText(booking.bookingRef).first()).toBeVisible();
      await desk.getByRole('button', { name: 'Record payment' }).click();
      const dialog = desk.getByRole('dialog', { name: 'Record payment' });
      await dialog.getByRole('button', { name: 'Record payment' }).click();
      await expect(dialog).toBeHidden();
      await expect(desk.getByText(/Paid .+ by /)).toBeVisible();
    });

    await test.step('admin sees the revenue in the report (US-05)', async () => {
      // daily_stats is updated by the worker's stats consumer, a moment after the payment.
      await expect(async () => {
        await openReport(admin, slot.date);
        expect(await revenue(admin)).toBe(before + booking.total.amountMinor);
      }).toPass({ timeout: 30_000 });
    });
  } finally {
    await adminContext.close();
    await receptionContext.close();
  }
});
