'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/form/form-error';
import { SelectField } from '@/components/form/select-field';
import { TextField } from '@/components/form/text-field';
import { TextareaField } from '@/components/form/textarea-field';
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
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { applyFieldErrors } from '@/features/auth/components/server-errors';
import { ApiError, ERROR_MESSAGES, errorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { toMajor, toMinor } from '@/lib/money';
import { usePublicSettings } from '@/lib/settings';
import { formatMinutes } from '@/lib/time';
import {
  useAdminCategories,
  useAdminServices,
  useSaveService,
  useSetServiceActive,
  type Category,
  type Service,
} from './api';
import { ImageUpload } from './image-upload';

// Services CRUD (FR-011, API-023..027): table, side-sheet form, confirm before deactivating.
export function ServicesAdmin() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const services = useAdminServices({ page, q });
  const categories = useAdminCategories();
  const setActive = useSetServiceActive();
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<Service | null>(null);
  const categoryName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? '—';

  const toggle = (service: Service, active: boolean) =>
    setActive.mutate(
      { id: service.id, active },
      {
        onSuccess: () => {
          toast.success(`${service.name} ${active ? 'is bookable again' : 'deactivated'}.`);
          setDeactivating(null);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <section className="grid gap-6">
      <PageHeader
        title="Services"
        description="Inactive services are hidden from customers but stay on past bookings."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> New service
          </Button>
        }
      />
      <Input
        type="search"
        aria-label="Search services"
        placeholder="Search services"
        className="max-w-xs"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />
      {services.isPending ? (
        <LoadingList label="Loading services" />
      ) : services.error ? (
        <ErrorState error={services.error} onRetry={() => void services.refetch()} />
      ) : services.data.data.length === 0 ? (
        <EmptyState
          title="No services yet"
          action={
            <Button variant="outline" onClick={() => setEditing('new')}>
              Add a service
            </Button>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.data.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{categoryName(s.categoryId)}</TableCell>
                  <TableCell>{formatMinutes(s.durationMin)}</TableCell>
                  <TableCell>{formatMoney(s.price.amountMinor, s.price.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={s.isActive ? 'success' : 'secondary'}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Edit ${s.name}`}
                      onClick={() => setEditing(s)}
                    >
                      Edit
                    </Button>
                    {s.isActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Deactivate ${s.name}`}
                        onClick={() => setDeactivating(s)}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Activate ${s.name}`}
                        onClick={() => toggle(s, true)}
                      >
                        Activate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={services.data.meta.page}
            totalPages={services.data.meta.totalPages}
            onPageChange={setPage}
          />
        </>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing ? (
          <DialogContent side="right">
            <DialogHeader>
              <DialogTitle>
                {editing === 'new' ? 'New service' : `Edit ${editing.name}`}
              </DialogTitle>
              <DialogDescription>Durations must fit the booking grid.</DialogDescription>
            </DialogHeader>
            <ServiceForm
              service={editing === 'new' ? null : editing}
              categories={(categories.data ?? []).filter(
                (c) => c.isActive || (editing !== 'new' && c.id === editing.categoryId),
              )}
              onDone={() => setEditing(null)}
            />
          </DialogContent>
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={`Deactivate ${deactivating?.name ?? ''}?`}
        description="Customers won't be able to book it. Existing bookings keep it."
        confirmLabel="Deactivate"
        pending={setActive.isPending}
        onConfirm={() => deactivating && toggle(deactivating, false)}
      />
    </section>
  );
}

function serviceSchema(currency: string, step: number) {
  return z.object({
    name: z.string().trim().min(2, 'Enter a name').max(80, 'Use at most 80 characters'),
    categoryId: z.string().min(1, 'Choose a category'),
    description: z.string().max(1000, 'Use at most 1000 characters'),
    durationMin: z.coerce
      .number<string>()
      .int('Whole minutes only')
      .positive('Enter a duration')
      .refine((v) => v % step === 0, { error: `Use a multiple of ${step} minutes` }),
    price: z
      .string()
      .refine((v) => toMinor(v, currency) !== null, { error: 'Enter a price like 450 or 450.50' }),
    imageUrl: z.string().nullable(),
  });
}

function ServiceForm({
  service,
  categories,
  onDone,
}: {
  service: Service | null;
  categories: Category[];
  onDone: () => void;
}) {
  const { data: settings } = usePublicSettings();
  const currency = service?.price.currency ?? settings?.currency ?? 'INR';
  const step = settings?.slotGranularityMin ?? 15;
  const schema = serviceSchema(currency, step);
  const save = useSaveService();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: service?.name ?? '',
      categoryId: service?.categoryId ?? '',
      description: service?.description ?? '',
      durationMin: String(service?.durationMin ?? step * 2),
      price: service ? toMajor(service.price.amountMinor, currency) : '',
      imageUrl: service?.imageUrl ?? null,
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const description = v.description.trim();
    const fields = {
      name: v.name,
      categoryId: v.categoryId,
      durationMin: v.durationMin,
      priceMinor: toMinor(v.price, currency)!,
    };
    try {
      await save.mutateAsync(
        service
          ? {
              id: service.id,
              body: { ...fields, description: description || null, imageUrl: v.imageUrl },
            }
          : {
              id: null,
              body: {
                ...fields,
                ...(description ? { description } : {}),
                ...(v.imageUrl ? { imageUrl: v.imageUrl } : {}),
              },
            },
      );
      toast.success(service ? 'Service saved.' : 'Service added.');
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_DURATION') {
        setError('durationMin', { type: 'server', message: ERROR_MESSAGES.INVALID_DURATION });
      } else if (error instanceof ApiError && error.code === 'DUPLICATE') {
        setError('name', { type: 'server', message: 'An active service already has this name.' });
      } else if (
        !applyFieldErrors(error, setError, ['name', 'categoryId', 'description', 'durationMin'])
      ) {
        setFormError(errorMessage(error));
      }
    }
  });

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
      <FormError>{formError}</FormError>
      <TextField label="Name" error={errors.name?.message} {...register('name')} />
      <SelectField label="Category" error={errors.categoryId?.message} {...register('categoryId')}>
        <option value="">Choose…</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <TextareaField
        label="Description"
        error={errors.description?.message}
        {...register('description')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Duration (minutes)"
          type="number"
          inputMode="numeric"
          step={step}
          min={step}
          error={errors.durationMin?.message}
          {...register('durationMin')}
        />
        <TextField
          label={`Price (${currency})`}
          inputMode="decimal"
          error={errors.price?.message}
          {...register('price')}
        />
      </div>
      <Controller
        control={control}
        name="imageUrl"
        render={({ field }) => (
          <ImageUpload label="Image" value={field.value} onChange={field.onChange} />
        )}
      />
      <Button type="submit" disabled={isSubmitting} className="justify-self-start">
        {isSubmitting ? 'Saving…' : 'Save service'}
      </Button>
    </form>
  );
}
