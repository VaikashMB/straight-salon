import { expect, test } from '@playwright/test';
import { createBooking, createWalkIn, firstFreeSlot, login, SEED, uniqueId } from './support/api';
import { signIn } from './support/ui';

// 05 §9: a stylist moves a booking through check-in → in service → completed from "My day"
// (US-04, FR-040/041).

interface Stylist {
  id: string;
  displayName: string;
  serviceIds: string[];
}

test('a stylist completes a booking from My day', async ({ page, request }) => {
  const reception = await login(request, SEED.reception);
  const ravi = ((await (await request.get('/api/v1/staff')).json()) as Stylist[]).find(
    (s) => s.displayName === 'Ravi',
  );
  if (!ravi) throw new Error('Seeded stylist "Ravi" not found; run `npm run seed`');

  // Stylists see the customer's first name only (API-052), so it is the unique part.
  const firstName = `E2e${uniqueId()}`;
  const customer = await createWalkIn(request, reception, `${firstName} Staff`);
  const slot = await firstFreeSlot(request, reception, ravi.serviceIds[0]!, ravi.id);
  await createBooking(request, reception, {
    serviceId: ravi.serviceIds[0]!,
    staffId: ravi.id,
    startAt: slot.startAt,
    customerId: customer.id,
  });

  // "My day" is today in the browser. The booking is on a later day (so the test does not depend
  // on the hour it runs), so the browser clock is set to its start; the API keeps real time.
  await page.clock.setFixedTime(new Date(slot.startAt));
  await signIn(page, SEED.ravi, /\/staff$/);
  await expect(page.getByRole('heading', { name: 'My day' })).toBeVisible();

  const card = page.getByRole('article').filter({ hasText: firstName });
  await expect(card).toContainText('Booked');
  for (const [action, status] of [
    ['Check in', 'Checked in'],
    ['Start service', 'In service'],
    ['Complete', 'Completed'],
  ] as const) {
    await card.getByRole('button', { name: `${action}: ${firstName}` }).click();
    await expect(card).toContainText(status);
  }
  await expect(card.getByRole('button')).toHaveCount(0); // COMPLETED has no next status
});
