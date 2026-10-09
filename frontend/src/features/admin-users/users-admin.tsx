'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
import { TextField } from '@/components/form/text-field';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { applyFieldErrors } from '@/features/auth/components/server-errors';
import { emailSchema, newPasswordSchema, phoneSchema } from '@/features/auth/schemas';
import { unwrap, type Schemas } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';

type Role = Schemas['Role'];
type User = Schemas['User'];

const ROLE_LABEL: Record<Role, string> = {
  CUSTOMER: 'Customer',
  STAFF: 'Stylist',
  RECEPTIONIST: 'Reception',
  ADMIN: 'Admin',
};

// People (API-011..015). Reception sees customers only; admins see everyone, create team
// accounts (FR-006), change roles and deactivate accounts (never their own).
export function UsersAdmin() {
  const { api, user: me } = useAuth();
  const isAdmin = me?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>(isAdmin ? '' : 'CUSTOMER');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const users = useQuery({
    queryKey: ['users', 'list', { q, role, page }],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/users', {
          params: {
            query: {
              page,
              pageSize: 20,
              ...(q.trim() ? { q: q.trim() } : {}),
              ...(role ? { role } : {}),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { role?: Role; isActive?: boolean } }) =>
      unwrap(api.PATCH('/api/v1/users/{id}', { params: { path: { id } }, body })),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(`${updated.name} updated.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const renderUsers = () => {
    if (users.isPending) return <LoadingList label="Loading people" />;
    if (users.error) return <ErrorState error={users.error} onRetry={() => void users.refetch()} />;
    if (users.data.data.length === 0)
      return (
        <EmptyState
          title="Nobody matches"
          description="Try another search."
          illustration="search"
        />
      );
    return (
      <>
        <div className="animate-fade-up rounded-lg shadow-soft">
          <Table>
            <TableHeader className="bg-muted/50 [&_th]:text-xs [&_th]:font-semibold [&_th]:tracking-wide [&_th]:uppercase">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.data.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  isAdmin={isAdmin}
                  isMe={u.id === me?.id}
                  pending={update.isPending}
                  onChange={(body) => update.mutate({ id: u.id, body })}
                />
              ))}
            </TableBody>
          </Table>
        </div>
        <Pagination
          page={users.data.meta.page}
          totalPages={users.data.meta.totalPages}
          onPageChange={setPage}
        />
      </>
    );
  };

  return (
    <section className="grid gap-6">
      <PageHeader
        title={isAdmin ? 'Customers & team' : 'Customers'}
        actions={
          isAdmin ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New team account
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <TextField
          label="Search"
          type="search"
          placeholder="Name, email or phone"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        {isAdmin ? (
          <SelectField
            label="Role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as Role | '');
              setPage(1);
            }}
          >
            <option value="">Everyone</option>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>
      {renderUsers()}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? (
          <DialogContent side="right">
            <DialogHeader>
              <DialogTitle>New team account</DialogTitle>
              <DialogDescription>
                Set a temporary password and share it with them; they change it after signing in.
              </DialogDescription>
            </DialogHeader>
            <NewTeamAccountForm onDone={() => setCreating(false)} />
          </DialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}

function UserRow({
  user,
  isAdmin,
  isMe,
  pending,
  onChange,
}: {
  user: User;
  isAdmin: boolean;
  isMe: boolean;
  pending: boolean;
  onChange: (body: { role?: Role; isActive?: boolean }) => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {user.name}
        {user.isWalkIn ? (
          <Badge variant="outline" className="ml-2">
            Walk-in
          </Badge>
        ) : null}
      </TableCell>
      <TableCell>
        {user.phone}
        {user.email ? (
          <span className="block text-xs text-muted-foreground">{user.email}</span>
        ) : null}
      </TableCell>
      <TableCell>
        {isAdmin && !isMe && !user.isWalkIn ? (
          <NativeSelect
            aria-label={`Role for ${user.name}`}
            className="h-8 w-36"
            value={user.role}
            disabled={pending}
            onChange={(e) => onChange({ role: e.target.value as Role })}
          >
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </NativeSelect>
        ) : (
          ROLE_LABEL[user.role]
        )}
      </TableCell>
      <TableCell>
        <Badge variant={user.isActive ? 'success' : 'secondary'}>
          {user.isActive ? 'Active' : 'Deactivated'}
        </Badge>
      </TableCell>
      {isAdmin ? (
        <TableCell className="text-right">
          {isMe ? (
            <span className="text-xs text-muted-foreground">You</span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              aria-label={`${user.isActive ? 'Deactivate' : 'Activate'} ${user.name}`}
              onClick={() => onChange({ isActive: !user.isActive })}
            >
              {user.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          )}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

export const teamAccountSchema = z.object({
  name: z.string().trim().min(2, 'Enter their name').max(80),
  email: emailSchema,
  phone: phoneSchema(),
  role: z.enum(['STAFF', 'RECEPTIONIST', 'ADMIN']),
  password: newPasswordSchema,
});

function NewTeamAccountForm({ onDone }: { onDone: () => void }) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof teamAccountSchema>, unknown, z.output<typeof teamAccountSchema>>({
    resolver: zodResolver(teamAccountSchema),
    defaultValues: { name: '', email: '', phone: '', role: 'STAFF', password: '' },
  });

  const onSubmit = handleSubmit(async (body) => {
    setFormError(null);
    try {
      const created = await unwrap(api.POST('/api/v1/users', { body }));
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(`${created.name}'s account is ready.`);
      onDone();
    } catch (error) {
      if (!applyFieldErrors(error, setError, ['name', 'email', 'phone', 'password'])) {
        setFormError(errorMessage(error));
      }
    }
  });

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
      <FormError>{formError}</FormError>
      <TextField label="Full name" error={errors.name?.message} {...register('name')} />
      <TextField label="Email" type="email" error={errors.email?.message} {...register('email')} />
      <TextField
        label="Mobile number"
        type="tel"
        error={errors.phone?.message}
        {...register('phone')}
      />
      <SelectField label="Role" {...register('role')}>
        <option value="STAFF">Stylist</option>
        <option value="RECEPTIONIST">Reception</option>
        <option value="ADMIN">Admin</option>
      </SelectField>
      <TextField
        label="Temporary password"
        type="text"
        autoComplete="off"
        hint="At least 8 characters, with a letter and a number."
        error={errors.password?.message}
        {...register('password')}
      />
      <Button type="submit" disabled={isSubmitting} className="justify-self-start">
        Create account
      </Button>
    </form>
  );
}
