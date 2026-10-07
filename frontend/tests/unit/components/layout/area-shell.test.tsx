import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { describe, expect, it } from 'vitest';
import AdminLayout from '@/app/(admin)/admin/layout';
import AdminPage from '@/app/(admin)/admin/page';
import AccountLayout from '@/app/(customer)/account/layout';
import AccountPage from '@/app/(customer)/account/page';
import StaffLayout from '@/app/(staff)/staff/layout';
import StaffPage from '@/app/(staff)/staff/page';
import { api, makeUser, problem, server, signedInAs } from '../../helpers/api';
import { router, setLocation } from '../../helpers/next-navigation';
import { renderWithProviders } from '../../helpers/render';

const admin = (
  <AdminLayout>
    <AdminPage />
  </AdminLayout>
);

describe('signed-in areas (05 §5 role checks in layouts)', () => {
  it('anonymous visitors are sent to sign in, keeping where they were going', async () => {
    setLocation('/admin');
    renderWithProviders(admin);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login?next=%2Fadmin'));
  });

  it('reception: dashboard landing with the shared items; ADMIN-only items hidden', async () => {
    signedInAs(makeUser({ name: 'Front Desk', role: 'RECEPTIONIST' }));
    server.use(http.get(api('/reports/dashboard'), () => problem(500, 'INTERNAL_ERROR')));
    setLocation('/admin');
    renderWithProviders(admin);
    const nav = await screen.findByRole('navigation', { name: 'Section' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByText('Bookings')).toBeInTheDocument();
    expect(within(nav).queryByText('Reports')).not.toBeInTheDocument();
    expect(screen.getByText('Front Desk · Reception')).toBeInTheDocument();
  });

  it('admin sees the ADMIN-only items as links', async () => {
    signedInAs(makeUser({ name: 'Salon Admin', role: 'ADMIN' }));
    server.use(http.get(api('/reports/dashboard'), () => problem(500, 'INTERNAL_ERROR')));
    setLocation('/admin/reports');
    renderWithProviders(admin);
    const nav = await screen.findByRole('navigation', { name: 'Section' });
    expect(within(nav).getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toHaveAttribute(
      'href',
      '/admin/audit',
    );
  });

  it('the wrong role is told and pointed to its own area', async () => {
    signedInAs(makeUser({ role: 'CUSTOMER' }));
    setLocation('/staff');
    renderWithProviders(
      <StaffLayout>
        <StaffPage />
      </StaffLayout>,
    );
    expect(
      await screen.findByRole('heading', { name: "This page isn't available to you" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to my area' })).toHaveAttribute('href', '/account');
  });

  it('customers land on their upcoming bookings', async () => {
    signedInAs(makeUser({ name: 'Ananya Rao', role: 'CUSTOMER' }));
    server.use(
      http.get(api('/bookings/me'), () =>
        HttpResponse.json({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }),
      ),
    );
    setLocation('/account');
    renderWithProviders(
      <AccountLayout>
        <AccountPage />
      </AccountLayout>,
    );
    expect(await screen.findByRole('heading', { name: 'Upcoming bookings' })).toBeInTheDocument();
    expect(await screen.findByText('No upcoming bookings')).toBeInTheDocument();
  });

  it('stylists see their day page', async () => {
    signedInAs(makeUser({ name: 'Ravi Kumar', role: 'STAFF' }));
    server.use(
      http.get(api('/bookings'), () =>
        HttpResponse.json({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }),
      ),
    );
    setLocation('/staff');
    renderWithProviders(
      <StaffLayout>
        <StaffPage />
      </StaffLayout>,
    );
    expect(await screen.findByRole('heading', { name: 'My day' })).toBeInTheDocument();
  });

  it('sign out ends the session and returns home (API-004)', async () => {
    let loggedOut = false;
    signedInAs(makeUser({ role: 'ADMIN' }));
    server.use(
      http.get(api('/reports/dashboard'), () => problem(500, 'INTERNAL_ERROR')),
      http.post(api('/auth/logout'), () => {
        loggedOut = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    setLocation('/admin');
    renderWithProviders(admin);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(loggedOut).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('You have been signed out.');
  });
});
