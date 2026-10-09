'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SelectField } from '@/components/form/select-field';
import { TextField } from '@/components/form/text-field';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { unwrap } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatDateTime } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';

const ENTITY_TYPES = [
  'booking',
  'user',
  'service',
  'category',
  'staff',
  'holiday',
  'settings',
  'review',
];
const OBJECT_ID = /^[a-f\d]{24}$/i;

interface Filters {
  entityType: string;
  entityId: string;
  actorId: string;
  action: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { entityType: '', entityId: '', actorId: '', action: '', from: '', to: '' };

// The audit log (FR-073, API-073): filter by entity, actor, action and date; each row expands
// to the changed paths and the before/after values (07 §2).
export function AuditAdmin() {
  const { api } = useAuth();
  const { data: settings } = usePublicSettings();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);

  // Only send ids that look valid; anything else would be a 400 for every keystroke.
  const query = {
    page,
    pageSize: 25,
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(OBJECT_ID.test(filters.entityId) ? { entityId: filters.entityId } : {}),
    ...(OBJECT_ID.test(filters.actorId) || filters.actorId === 'system'
      ? { actorId: filters.actorId }
      : {}),
    ...(filters.action.trim() ? { action: filters.action.trim() } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  };
  const logs = useQuery({
    queryKey: ['audit', query],
    queryFn: () => unwrap(api.GET('/api/v1/audit-logs', { params: { query } })),
    placeholderData: keepPreviousData,
  });
  const set = (field: keyof Filters) => (e: { target: { value: string } }) => {
    setFilters((f) => ({ ...f, [field]: e.target.value }));
    setPage(1);
  };

  const renderLogs = () => {
    if (logs.isPending || !settings) return <LoadingList label="Loading audit log" />;
    if (logs.error) return <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />;
    if (logs.data.data.length === 0)
      return <EmptyState title="No entries match" illustration="search" />;
    return (
      <>
        <ul className="grid gap-2">
          {logs.data.data.map((entry) => (
            <li key={entry.id}>
              <details className="rounded-xl border bg-card shadow-soft">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>
                    <span className="font-medium">{entry.action}</span> · {entry.entityType}{' '}
                    {entry.entityId}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(entry.at, settings.timezone)} · {entry.actor.role}{' '}
                    {entry.actor.id}
                  </span>
                </summary>
                <div className="grid gap-3 border-t p-3 text-sm">
                  <p>
                    Changed: {entry.diff.length ? entry.diff.join(', ') : 'nothing recorded'}
                    {entry.requestId ? (
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        · request {entry.requestId}
                      </span>
                    ) : null}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Json label="Before" value={entry.before} />
                    <Json label="After" value={entry.after} />
                  </div>
                  {entry.metadata && Object.keys(entry.metadata).length ? (
                    <Json label="Details" value={entry.metadata} />
                  ) : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
        <Pagination
          page={logs.data.meta.page}
          totalPages={logs.data.meta.totalPages}
          onPageChange={setPage}
        />
      </>
    );
  };

  return (
    <section className="grid gap-6">
      <PageHeader title="Audit log" description="Who changed what, and when. Newest first." />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Entity" value={filters.entityType} onChange={set('entityType')}>
          <option value="">Any entity</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </SelectField>
        <TextField label="Entity id" value={filters.entityId} onChange={set('entityId')} />
        <TextField
          label="Actor id"
          placeholder="user id or system"
          value={filters.actorId}
          onChange={set('actorId')}
        />
        <TextField
          label="Action"
          placeholder="e.g. booking.cancel"
          value={filters.action}
          onChange={set('action')}
        />
        <TextField label="From" type="date" value={filters.from} onChange={set('from')} />
        <TextField label="To" type="date" value={filters.to} onChange={set('to')} />
      </div>
      {renderLogs()}
    </section>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <figure className="grid gap-1">
      <figcaption className="text-xs font-medium text-muted-foreground">{label}</figcaption>
      <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
        {value === null ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </figure>
  );
}
