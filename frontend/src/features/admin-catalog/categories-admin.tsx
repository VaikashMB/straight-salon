'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/form/form-error';
import { TextField } from '@/components/form/text-field';
import { TextareaField } from '@/components/form/textarea-field';
import { PageHeader } from '@/components/page-header';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, errorMessage } from '@/lib/errors';
import { useAdminCategories, useSaveCategory, useSetCategoryActive, type Category } from './api';

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(60, 'Use at most 60 characters'),
  description: z.string().max(500, 'Use at most 500 characters'),
  sortOrder: z.coerce
    .number<string>()
    .int('Whole numbers only')
    .min(0, 'Use 0 or more')
    .max(1000, 'Use 1000 or less'),
});

// Service categories (FR-010, API-021/022). Delete = deactivate.
export function CategoriesAdmin() {
  const categories = useAdminCategories();
  const setActive = useSetCategoryActive();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<Category | null>(null);

  const toggle = (category: Category, active: boolean) =>
    setActive.mutate(
      { id: category.id, active },
      {
        onSuccess: () => {
          toast.success(`${category.name} ${active ? 'activated' : 'deactivated'}.`);
          setDeactivating(null);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  const renderCategories = () => {
    if (categories.isPending) return <LoadingList label="Loading categories" />;
    if (categories.error)
      return <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />;
    if (categories.data.length === 0)
      return (
        <EmptyState
          title="No categories yet"
          action={
            <Button variant="outline" onClick={() => setEditing('new')}>
              Add a category
            </Button>
          }
        />
      );
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.data.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">
                {c.name}
                {c.description ? (
                  <span className="block text-xs text-muted-foreground">{c.description}</span>
                ) : null}
              </TableCell>
              <TableCell>{c.sortOrder}</TableCell>
              <TableCell>
                <Badge variant={c.isActive ? 'success' : 'secondary'}>
                  {c.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              <TableCell className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Edit ${c.name}`}
                  onClick={() => setEditing(c)}
                >
                  Edit
                </Button>
                {c.isActive ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Deactivate ${c.name}`}
                    onClick={() => setDeactivating(c)}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Activate ${c.name}`}
                    onClick={() => toggle(c, true)}
                  >
                    Activate
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  return (
    <section className="grid gap-6">
      <PageHeader
        title="Categories"
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> New category
          </Button>
        }
      />
      {renderCategories()}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing ? (
          <DialogContent side="right">
            <DialogHeader>
              <DialogTitle>
                {editing === 'new' ? 'New category' : `Edit ${editing.name}`}
              </DialogTitle>
              <DialogDescription>
                Categories group services in the catalogue, lowest order first.
              </DialogDescription>
            </DialogHeader>
            <CategoryForm
              category={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          </DialogContent>
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={`Deactivate ${deactivating?.name ?? ''}?`}
        description="The category is hidden from the public catalogue."
        confirmLabel="Deactivate"
        pending={setActive.isPending}
        onConfirm={() => deactivating && toggle(deactivating, false)}
      />
    </section>
  );
}

function CategoryForm({ category, onDone }: { category: Category | null; onDone: () => void }) {
  const save = useSaveCategory();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof categorySchema>, unknown, z.output<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: category?.name ?? '',
      description: category?.description ?? '',
      sortOrder: String(category?.sortOrder ?? 0),
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const description = v.description.trim();
    try {
      const fields = { name: v.name, sortOrder: v.sortOrder };
      await save.mutateAsync(
        category
          ? { id: category.id, body: { ...fields, description: description || null } }
          : { id: null, body: { ...fields, ...(description ? { description } : {}) } },
      );
      toast.success(category ? 'Category saved.' : 'Category added.');
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DUPLICATE') {
        setError('name', { type: 'server', message: 'A category with this name already exists.' });
      } else {
        setFormError(errorMessage(error));
      }
    }
  });

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
      <FormError>{formError}</FormError>
      <TextField label="Name" error={errors.name?.message} {...register('name')} />
      <TextareaField
        label="Description"
        error={errors.description?.message}
        {...register('description')}
      />
      <TextField
        label="Order"
        type="number"
        inputMode="numeric"
        min={0}
        error={errors.sortOrder?.message}
        {...register('sortOrder')}
      />
      <Button type="submit" disabled={isSubmitting} className="justify-self-start">
        {isSubmitting ? 'Saving…' : 'Save category'}
      </Button>
    </form>
  );
}
