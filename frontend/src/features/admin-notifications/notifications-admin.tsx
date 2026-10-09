'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SelectField } from '@/components/form/select-field';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Badge } from '@/components/ui/badge';
import { unwrap, type Schemas } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatDateTime } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';

type Notification = Schemas['Notification'];
type Channel = Notification['channel'];
type Status = Notification['status'];
type Template = Notification['template'];

const TEMPLATES: Template[] = [
  'welcome',
  'password_reset',
  'booking_confirmed',
  'booking_rescheduled',
  'booking_cancelled',
  'booking_reminder_24h',
  'booking_reminder_2h',
  'booking_no_show',
  'booking_thank_you',
  'staff_booking_assigned',
  'staff_booking_changed',
  'staff_booking_cancelled',
];

const STATUS_VARIANT = { QUEUED: 'outline', SENT: 'success', FAILED: 'destructive' } as const;

// Sent and failed messages (API-066), e.g. to read mock-sent email/SMS in development.
export function NotificationsAdmin() {
  const { api } = useAuth();
  const { data: settings } = usePublicSettings();
  const [channel, setChannel] = useState<Channel | ''>('');
  const [status, setStatus] = useState<Status | ''>('');
  const [template, setTemplate] = useState<Template | ''>('');
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ['notifications', 'admin', { channel, status, template, page }],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/notifications', {
          params: {
            query: {
              page,
              pageSize: 25,
              ...(channel ? { channel } : {}),
              ...(status ? { status } : {}),
              ...(template ? { template } : {}),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });
  const reset = () => setPage(1);

  const renderNotifications = () => {
    if (list.isPending || !settings) return <LoadingList label="Loading notifications" />;
    if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
    if (list.data.data.length === 0)
      return <EmptyState title="No notifications match" illustration="search" />;
    return (
      <>
        <ul className="grid gap-2">
          {list.data.data.map((n) => (
            <li key={n.id}>
              <details className="group rounded-xl border bg-card shadow-soft">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>
                    <span className="font-medium">{n.template.replace(/_/g, ' ')}</span> ·{' '}
                    {n.channel} · {n.to}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {formatDateTime(n.createdAt, settings.timezone)}
                    <Badge variant={STATUS_VARIANT[n.status]}>{n.status.toLowerCase()}</Badge>
                  </span>
                </summary>
                <div className="grid gap-2 border-t p-3 text-sm">
                  {n.content.subject ? <p className="font-medium">{n.content.subject}</p> : null}
                  <pre className="font-sans whitespace-pre-wrap">{n.content.text}</pre>
                  <p className="text-xs text-muted-foreground">
                    {n.attempts} attempt(s){n.provider ? ` · via ${n.provider}` : ''}
                    {n.providerMessageId ? ` · ${n.providerMessageId}` : ''}
                  </p>
                  {n.error ? <p className="text-xs text-destructive">Error: {n.error}</p> : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
        <Pagination
          page={list.data.meta.page}
          totalPages={list.data.meta.totalPages}
          onPageChange={setPage}
        />
      </>
    );
  };

  return (
    <section className="grid gap-6">
      <PageHeader
        title="Notifications"
        description="Emails and text messages, newest first. Reset links are redacted."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="Channel"
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value as Channel | '');
            reset();
          }}
        >
          <option value="">Any channel</option>
          <option value="EMAIL">Email</option>
          <option value="SMS">SMS</option>
        </SelectField>
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as Status | '');
            reset();
          }}
        >
          <option value="">Any status</option>
          <option value="QUEUED">Queued</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
        </SelectField>
        <SelectField
          label="Template"
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value as Template | '');
            reset();
          }}
        >
          <option value="">Any template</option>
          {TEMPLATES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </SelectField>
      </div>
      {renderNotifications()}
    </section>
  );
}
