import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import CategoriesPage from '@/app/(admin)/admin/categories/page';
import CustomersPage from '@/app/(admin)/admin/customers/page';
import ServicesPage from '@/app/(admin)/admin/services/page';
import StaffDetailPage from '@/app/(admin)/admin/staff/[id]/page';
import StaffPage from '@/app/(admin)/admin/staff/page';
import { scheduleProblem } from '@/features/admin-staff/schedule-editor';
import { api, makeUser, problem, server, signedInAs } from '../../helpers/api';
import { categories, ids, makeService, page, services, stylists } from '../../helpers/fixtures';
import { renderWithProviders } from '../../helpers/render';

const user = () => userEvent.setup();
const admin = () => signedInAs(makeUser({ id: 'me', name: 'Salon Admin', role: 'ADMIN' }));

describe('ADMIN-only pages (05 §3)', () => {
  it('reception is told the page is for admins', async () => {
    signedInAs(makeUser({ role: 'RECEPTIONIST' }));
    renderWithProviders(<ServicesPage />);
    expect(
      await screen.findByRole('heading', { name: 'This page is for admins' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute(
      'href',
      '/admin',
    );
  });
});

describe('services admin (FR-011, API-023..027)', () => {
  function servicesApi() {
    const calls: { method: string; path: string; body?: unknown; query?: string }[] = [];
    server.use(
      http.get(api('/categories'), ({ request }) => {
        calls.push({ method: 'GET', path: 'categories', query: new URL(request.url).search });
        return HttpResponse.json([
          ...categories,
          { ...categories[0]!, id: 'gone', name: 'Old', isActive: false },
        ]);
      }),
      http.get(api('/services'), ({ request }) => {
        calls.push({ method: 'GET', path: 'services', query: new URL(request.url).search });
        return HttpResponse.json(
          page([...services, makeService({ id: 'x1', name: 'Retired', isActive: false })]),
        );
      }),
      http.post(api('/services'), async ({ request }) => {
        calls.push({ method: 'POST', path: 'services', body: await request.json() });
        return HttpResponse.json(makeService(), { status: 201 });
      }),
      http.patch(api('/services/:id'), async ({ request, params }) => {
        calls.push({
          method: 'PATCH',
          path: `services/${String(params.id)}`,
          body: await request.json(),
        });
        return HttpResponse.json(makeService());
      }),
      http.delete(api('/services/:id'), ({ params }) => {
        calls.push({ method: 'DELETE', path: `services/${String(params.id)}` });
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(api('/uploads/images'), () =>
        HttpResponse.json({ url: 'http://localhost:4000/uploads/new.webp' }, { status: 201 }),
      ),
    );
    return calls;
  }

  it('lists everything including inactive, and creates a service with an image', async () => {
    admin();
    const calls = servicesApi();
    renderWithProviders(<ServicesPage />);
    const u = user();
    expect(await screen.findByText('Retired')).toBeInTheDocument();
    expect(calls.find((c) => c.path === 'services')?.query).toContain('includeInactive=true');
    await u.click(screen.getByRole('button', { name: /New service/ }));
    const sheet = await screen.findByRole('dialog', { name: 'New service' });
    expect(within(sheet).queryByRole('option', { name: 'Old' })).not.toBeInTheDocument();
    await u.click(within(sheet).getByRole('button', { name: 'Save service' }));
    expect(await within(sheet).findByText('Enter a name')).toBeInTheDocument();
    expect(within(sheet).getByText('Choose a category')).toBeInTheDocument();
    expect(within(sheet).getByText('Enter a price like 450 or 450.50')).toBeInTheDocument();
    await u.type(within(sheet).getByLabelText('Name'), 'Head Massage');
    await u.selectOptions(within(sheet).getByLabelText('Category'), 'Hair');
    await u.clear(within(sheet).getByLabelText('Duration (minutes)'));
    await u.type(within(sheet).getByLabelText('Duration (minutes)'), '20');
    await u.type(within(sheet).getByLabelText('Price (INR)'), '350.5');
    await u.click(within(sheet).getByRole('button', { name: 'Save service' }));
    expect(await within(sheet).findByText('Use a multiple of 15 minutes')).toBeInTheDocument();
    await u.clear(within(sheet).getByLabelText('Duration (minutes)'));
    await u.type(within(sheet).getByLabelText('Duration (minutes)'), '30');
    await u.upload(
      within(sheet).getByLabelText('Image'),
      new File(['x'], 'a.png', { type: 'image/png' }),
    );
    expect(await within(sheet).findByRole('button', { name: 'Remove' })).toBeInTheDocument();
    await u.click(within(sheet).getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Service added.'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Head Massage',
      categoryId: ids.hair,
      durationMin: 30,
      priceMinor: 35_050,
      imageUrl: 'http://localhost:4000/uploads/new.webp',
    });
  });

  it('rejects the wrong file type before uploading', async () => {
    admin();
    servicesApi();
    renderWithProviders(<ServicesPage />);
    const u = userEvent.setup({ applyAccept: false });
    await u.click(await screen.findByRole('button', { name: /New service/ }));
    const sheet = await screen.findByRole('dialog');
    await u.upload(
      within(sheet).getByLabelText('Image'),
      new File(['x'], 'a.gif', { type: 'image/gif' }),
    );
    expect(
      within(sheet).getByText('Please choose a PNG, JPEG or WebP image up to 2 MB.'),
    ).toBeInTheDocument();
  });

  it('edits (clearing the description), deactivates after confirming and reactivates', async () => {
    admin();
    const calls = servicesApi();
    renderWithProviders(<ServicesPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Edit Haircut' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit Haircut' });
    expect(within(sheet).getByLabelText('Price (INR)')).toHaveValue('400.00');
    await u.clear(within(sheet).getByLabelText('Description'));
    await u.click(within(sheet).getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Service saved.'));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      name: 'Haircut',
      categoryId: ids.hair,
      durationMin: 45,
      priceMinor: 40_000,
      description: null,
      imageUrl: null,
    });

    await u.click(screen.getByRole('button', { name: 'Deactivate Haircut' }));
    await u.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === `services/${ids.haircut}`)).toBe(
        true,
      ),
    );
    await u.click(screen.getByRole('button', { name: 'Activate Retired' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === 'services/x1' && c.method === 'PATCH')).toBe(true),
    );
  });

  it('maps duplicate names and grid violations onto the fields', async () => {
    admin();
    servicesApi();
    server.use(http.patch(api('/services/:id'), () => problem(422, 'INVALID_DURATION')));
    renderWithProviders(<ServicesPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Edit Haircut' }));
    const sheet = await screen.findByRole('dialog');
    await u.click(within(sheet).getByRole('button', { name: 'Save service' }));
    expect(
      await within(sheet).findByText('The duration must fit the booking grid.'),
    ).toBeInTheDocument();
    server.use(http.patch(api('/services/:id'), () => problem(409, 'DUPLICATE')));
    await u.click(within(sheet).getByRole('button', { name: 'Save service' }));
    expect(
      await within(sheet).findByText('An active service already has this name.'),
    ).toBeInTheDocument();
  });
});

describe('categories admin (FR-010, API-021/022)', () => {
  it('creates, edits, deactivates and reactivates', async () => {
    admin();
    const calls: { method: string; body?: unknown }[] = [];
    server.use(
      http.get(api('/categories'), () =>
        HttpResponse.json([
          ...categories,
          { ...categories[0]!, id: 'old', name: 'Old', isActive: false },
        ]),
      ),
      http.post(api('/categories'), async ({ request }) => {
        calls.push({ method: 'POST', body: await request.json() });
        return HttpResponse.json(categories[0], { status: 201 });
      }),
      http.patch(api('/categories/:id'), async ({ request }) => {
        calls.push({ method: 'PATCH', body: await request.json() });
        return HttpResponse.json(categories[0]);
      }),
      http.delete(api('/categories/:id'), () => {
        calls.push({ method: 'DELETE' });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<CategoriesPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: /New category/ }));
    let sheet = await screen.findByRole('dialog', { name: 'New category' });
    await u.type(within(sheet).getByLabelText('Name'), 'Spa');
    await u.clear(within(sheet).getByLabelText('Order'));
    await u.type(within(sheet).getByLabelText('Order'), '5');
    await u.click(within(sheet).getByRole('button', { name: 'Save category' }));
    await waitFor(() =>
      expect(calls[0]).toEqual({ method: 'POST', body: { name: 'Spa', sortOrder: 5 } }),
    );

    await u.click(screen.getByRole('button', { name: 'Edit Hair' }));
    sheet = await screen.findByRole('dialog', { name: 'Edit Hair' });
    await u.type(within(sheet).getByLabelText('Description'), 'Cuts');
    await u.click(within(sheet).getByRole('button', { name: 'Save category' }));
    await waitFor(() =>
      expect(calls[1]).toEqual({
        method: 'PATCH',
        body: { name: 'Hair', sortOrder: 1, description: 'Cuts' },
      }),
    );

    await u.click(screen.getByRole('button', { name: 'Deactivate Hair' }));
    await u.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }),
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    await u.click(screen.getByRole('button', { name: 'Activate Old' }));
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({ method: 'PATCH', body: { isActive: true } }),
    );
  });

  it('a duplicate name is shown on the field', async () => {
    admin();
    server.use(
      http.get(api('/categories'), () => HttpResponse.json([])),
      http.post(api('/categories'), () => problem(409, 'DUPLICATE')),
    );
    renderWithProviders(<CategoriesPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Add a category' }));
    const sheet = await screen.findByRole('dialog');
    await u.type(within(sheet).getByLabelText('Name'), 'Hair');
    await u.click(within(sheet).getByRole('button', { name: 'Save category' }));
    expect(
      await within(sheet).findByText('A category with this name already exists.'),
    ).toBeInTheDocument();
  });
});

describe('stylists admin (FR-020, FR-023, API-030..037)', () => {
  const weekly = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    isWorking: dayOfWeek !== 1,
    start: '10:00',
    end: '19:00',
    breaks: [],
  }));

  it('lists stylists and adds a profile for an unlinked staff account', async () => {
    admin();
    let created: unknown = null;
    server.use(
      http.get(api('/staff'), () =>
        HttpResponse.json([
          { ...stylists[0]!, userId: 'u-ravi', isActive: true },
          { ...stylists[1]!, userId: 'u-meera', isActive: false },
        ]),
      ),
      http.get(api('/services'), () => HttpResponse.json(page(services))),
      http.get(api('/users'), () =>
        HttpResponse.json(
          page([
            makeUser({ id: 'u-ravi', name: 'Ravi Kumar', role: 'STAFF' }),
            makeUser({ id: 'u-new', name: 'Asha Menon', role: 'STAFF', email: 'asha@x.com' }),
          ]),
        ),
      ),
      http.post(api('/staff'), async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderWithProviders(<StaffPage />);
    const u = user();
    expect(await screen.findByRole('link', { name: /Ravi/ })).toHaveAttribute(
      'href',
      `/admin/staff/${ids.ravi}`,
    );
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /New stylist/ }));
    const sheet = await screen.findByRole('dialog', { name: 'New stylist' });
    await u.click(within(sheet).getByRole('button', { name: 'Add stylist' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Choose the staff account.');
    expect(within(sheet).queryByRole('option', { name: /Ravi Kumar/ })).not.toBeInTheDocument();
    await u.selectOptions(
      within(sheet).getByLabelText('Staff account'),
      await within(sheet).findByRole('option', { name: /Asha Menon/ }),
    );
    expect(within(sheet).getByLabelText('Display name')).toHaveValue('Asha');
    await u.click(within(sheet).getByLabelText('Haircut'));
    await u.click(within(sheet).getByRole('button', { name: 'Add stylist' }));
    await waitFor(() =>
      expect(created).toEqual({ userId: 'u-new', displayName: 'Asha', serviceIds: [ids.haircut] }),
    );
  });

  function detailApi() {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    server.use(
      http.get(api('/staff/:id'), ({ params }) =>
        params.id === ids.ravi
          ? HttpResponse.json({
              ...stylists[0]!,
              userId: 'u-ravi',
              isActive: true,
              services: services.slice(0, 2),
            })
          : problem(404, 'NOT_FOUND'),
      ),
      http.get(api('/services'), () => HttpResponse.json(page(services))),
      http.get(api('/staff/:id/schedule'), () => HttpResponse.json({ staffId: ids.ravi, weekly })),
      http.get(api('/staff/:id/time-off'), () => HttpResponse.json([])),
      http.patch(api('/staff/:id'), async ({ request }) => {
        const body = (await request.json()) as { isActive?: boolean; force?: boolean };
        calls.push({ method: 'PATCH', path: 'staff', body });
        if (body.isActive === false && !body.force) return problem(422, 'ACTIVE_BOOKINGS_EXIST');
        return HttpResponse.json({ ...stylists[0]!, services: [] });
      }),
      http.put(api('/staff/:id/schedule'), async ({ request }) => {
        calls.push({ method: 'PUT', path: 'schedule', body: await request.json() });
        return HttpResponse.json({ staffId: ids.ravi, weekly });
      }),
      http.post(api('/staff/:id/time-off'), async ({ request }) => {
        const body = (await request.json()) as { force?: boolean };
        calls.push({ method: 'POST', path: 'time-off', body });
        return body.force
          ? HttpResponse.json({}, { status: 201 })
          : problem(422, 'ACTIVE_BOOKINGS_EXIST');
      }),
    );
    return calls;
  }

  it('saves the profile; deactivating with bookings asks before forcing (BR-014)', async () => {
    admin();
    const calls = detailApi();
    renderWithProviders(await StaffDetailPage({ params: Promise.resolve({ id: ids.ravi }) }));
    const u = user();
    await u.type(await screen.findByLabelText('Bio'), ' Ten years.');
    await u.click(screen.getByLabelText('Hair Colour'));
    await u.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() =>
      expect(calls[0]?.body).toEqual({
        displayName: 'Ravi',
        bio: 'Fades and classic cuts. Ten years.',
        photoUrl: null,
        serviceIds: [ids.haircut, ids.beardTrim, ids.colour],
      }),
    );
    await u.click(screen.getByRole('button', { name: 'Deactivate stylist' }));
    await u.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }),
    );
    const force = await screen.findByRole('dialog', { name: 'This stylist has upcoming bookings' });
    await u.click(within(force).getByRole('button', { name: 'Cancel bookings and deactivate' }));
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ isActive: false, force: true }));
    expect(toast.success).toHaveBeenCalledWith(
      'Stylist deactivated; their future bookings were cancelled.',
    );
  });

  it('edits the weekly schedule with breaks (API-034)', async () => {
    admin();
    const calls = detailApi();
    renderWithProviders(await StaffDetailPage({ params: Promise.resolve({ id: ids.ravi }) }));
    const u = user();
    await u.click(await screen.findByRole('tab', { name: 'Schedule' }));
    await u.click(await screen.findByLabelText('Monday'));
    await u.click(screen.getAllByRole('button', { name: /Break/ })[0]!);
    await u.clear(screen.getByLabelText('Tuesday end'));
    await u.type(screen.getByLabelText('Tuesday end'), '09:00');
    await u.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tuesday: the end must be after the start.',
    );
    await u.clear(screen.getByLabelText('Tuesday end'));
    await u.type(screen.getByLabelText('Tuesday end'), '19:00');
    await u.click(screen.getByRole('button', { name: 'Remove Monday break 1' }));
    await u.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Schedule saved.'));
    const saved = (calls.find((c) => c.method === 'PUT')?.body as { weekly: typeof weekly }).weekly;
    expect(saved.find((d) => d.dayOfWeek === 1)).toEqual({
      dayOfWeek: 1,
      isWorking: true,
      start: '10:00',
      end: '19:00',
      breaks: [],
    });
  });

  it('admins may force time off over bookings (FR-024)', async () => {
    admin();
    const calls = detailApi();
    renderWithProviders(await StaffDetailPage({ params: Promise.resolve({ id: ids.ravi }) }));
    const u = user();
    await u.click(await screen.findByRole('tab', { name: 'Time off' }));
    await u.click(await screen.findByRole('button', { name: 'Add time off' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bookings in the way' });
    await u.click(within(dialog).getByRole('button', { name: 'Cancel bookings and add' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Time off added; clashing bookings were cancelled.',
      ),
    );
    expect(
      calls.filter((c) => c.path === 'time-off').map((c) => (c.body as { force?: boolean }).force),
    ).toEqual([undefined, true]);
  });

  it('unknown stylists are not found', async () => {
    admin();
    detailApi();
    renderWithProviders(await StaffDetailPage({ params: Promise.resolve({ id: ids.meera }) }));
    expect(await screen.findByRole('heading', { name: 'Stylist not found' })).toBeInTheDocument();
  });

  it('schedule validation rules', () => {
    const day = {
      dayOfWeek: 2,
      isWorking: true,
      start: '10:00',
      end: '19:00',
      breaks: [] as { start: string; end: string }[],
    };
    expect(scheduleProblem([day])).toBeNull();
    expect(scheduleProblem([{ ...day, isWorking: false, start: '20:00' }])).toBeNull();
    expect(scheduleProblem([{ ...day, breaks: [{ start: '14:00', end: '13:00' }] }])).toMatch(
      /each break must end/,
    );
    expect(scheduleProblem([{ ...day, breaks: [{ start: '09:00', end: '10:30' }] }])).toMatch(
      /within working hours/,
    );
    expect(
      scheduleProblem([
        {
          ...day,
          breaks: [
            { start: '13:00', end: '14:00' },
            { start: '13:30', end: '15:00' },
          ],
        },
      ]),
    ).toMatch(/must not overlap/);
  });
});

describe('customers & team (API-011..015, FR-006)', () => {
  it('reception sees customers only, without account actions', async () => {
    signedInAs(makeUser({ role: 'RECEPTIONIST' }));
    const roles: (string | null)[] = [];
    server.use(
      http.get(api('/users'), ({ request }) => {
        roles.push(new URL(request.url).searchParams.get('role'));
        return HttpResponse.json(page([makeUser({ isWalkIn: true, email: undefined })]));
      }),
    );
    renderWithProviders(<CustomersPage />);
    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeInTheDocument();
    expect(await screen.findByText('Walk-in')).toBeInTheDocument();
    expect(roles).toEqual(['CUSTOMER']);
    expect(screen.queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Role')).not.toBeInTheDocument();
  });

  it('admins change roles and status (never their own) and create team accounts', async () => {
    admin();
    const patches: unknown[] = [];
    let created: unknown = null;
    server.use(
      http.get(api('/users'), () =>
        HttpResponse.json(
          page([
            makeUser({ id: 'me', name: 'Salon Admin', role: 'ADMIN' }),
            makeUser({ id: 'u2', name: 'Kiran' }),
          ]),
        ),
      ),
      http.patch(api('/users/:id'), async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json(makeUser({ name: 'Kiran' }));
      }),
      http.post(api('/users'), async ({ request }) => {
        created = await request.json();
        return HttpResponse.json(makeUser({ name: 'Asha Menon', role: 'RECEPTIONIST' }), {
          status: 201,
        });
      }),
    );
    renderWithProviders(<CustomersPage />);
    const u = user();
    expect(await screen.findByText('You')).toBeInTheDocument();
    expect(screen.queryByLabelText('Role for Salon Admin')).not.toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText('Role for Kiran'), 'Reception');
    await u.click(screen.getByRole('button', { name: 'Deactivate Kiran' }));
    await waitFor(() => expect(patches).toEqual([{ role: 'RECEPTIONIST' }, { isActive: false }]));
    await u.selectOptions(screen.getByLabelText('Role'), 'Stylist');

    await u.click(screen.getByRole('button', { name: /New team account/ }));
    const sheet = await screen.findByRole('dialog', { name: 'New team account' });
    await u.type(within(sheet).getByLabelText('Full name'), 'Asha Menon');
    await u.type(within(sheet).getByLabelText('Email'), 'Asha@Salon.local');
    await u.type(within(sheet).getByLabelText('Mobile number'), '9000000009');
    await u.selectOptions(within(sheet).getByLabelText('Role'), 'Reception');
    await u.type(within(sheet).getByLabelText('Temporary password'), 'Welcome-2026');
    await u.click(within(sheet).getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(created).toEqual({
        name: 'Asha Menon',
        email: 'asha@salon.local',
        phone: '+919000000009',
        role: 'RECEPTIONIST',
        password: 'Welcome-2026',
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Asha Menon's account is ready.");
  });

  it('server field errors land on the form; a failed update toasts', async () => {
    admin();
    server.use(
      http.get(api('/users'), () =>
        HttpResponse.json(page([makeUser({ id: 'u2', name: 'Kiran' })])),
      ),
      http.patch(api('/users/:id'), () => problem(403, 'FORBIDDEN')),
      http.post(api('/users'), () =>
        problem(400, 'VALIDATION_FAILED', {
          errors: [{ path: 'password', message: 'Too common' }],
        }),
      ),
    );
    renderWithProviders(<CustomersPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Deactivate Kiran' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("You don't have permission to do that."),
    );
    await u.click(screen.getByRole('button', { name: /New team account/ }));
    const sheet = await screen.findByRole('dialog');
    await u.type(within(sheet).getByLabelText('Full name'), 'Asha');
    await u.type(within(sheet).getByLabelText('Email'), 'a@b.co');
    await u.type(within(sheet).getByLabelText('Mobile number'), '9000000009');
    await u.type(within(sheet).getByLabelText('Temporary password'), 'Password1');
    await u.click(within(sheet).getByRole('button', { name: 'Create account' }));
    expect(await within(sheet).findByText('Too common')).toBeInTheDocument();
  });
});

vi.setConfig({ testTimeout: 15_000 });
