'use client';

import { useMutation } from '@tanstack/react-query';
import Image from 'next/image';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { unwrap } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';

const ACCEPT = 'image/png,image/jpeg,image/webp';
const MAX_BYTES = 2 * 1024 * 1024; // 06 §4

// API-027: uploads one image and reports its URL, which the form then saves on the service or
// stylist (API-025 / API-032).
export function ImageUpload({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const { api } = useAuth();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      // The typed body is a placeholder: the serializer sends the multipart form instead.
      return unwrap(
        api.POST('/api/v1/uploads/images', { body: { file: '' }, bodySerializer: () => form }),
      );
    },
    onSuccess: (result) => onChange(result.url),
    onError: (e) => setError(errorMessage(e)),
  });

  const pick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!ACCEPT.split(',').includes(file.type) || file.size > MAX_BYTES) {
      setError('Please choose a PNG, JPEG or WebP image up to 2 MB.');
      return;
    }
    upload.mutate(file);
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        {value ? (
          <Image
            src={value}
            alt=""
            width={64}
            height={64}
            unoptimized
            className="size-16 rounded-md object-cover"
          />
        ) : null}
        <input
          id={id}
          type="file"
          accept={ACCEPT}
          aria-describedby={error ? `${id}-error` : undefined}
          className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Remove
          </Button>
        ) : null}
      </div>
      {upload.isPending ? <p className="text-xs text-muted-foreground">Uploading…</p> : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
