'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

import { uploadInvoiceDocuments, type UploadState } from './actions';

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
const MAX_FILES = 25;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Submit({ count }: { count: number }) {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending ? t.upload.reading : t.upload.readCount(count)}
    </Button>
  );
}

/**
 * The drop target.
 *
 * The chosen files live on the file input itself rather than in React state,
 * with the list below rendered from it. Keeping one copy is what makes the form
 * submission and the visible list incapable of disagreeing — the alternative,
 * a state array assembled separately, eventually posts something other than what
 * the operator is looking at.
 */
export function Dropzone({ reviewHref }: { reviewHref?: string }) {
  const t = useT();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [state, action] = useActionState<UploadState, FormData>(uploadInvoiceDocuments, {});

  // Dropped somewhere that has no review queue under it — the dashboard — so
  // carry the operator to where their reading is waiting. Without this the file
  // is read, the card is filed, and the screen says so and then sits there: the
  // work is done somewhere the person cannot see.
  useEffect(() => {
    if (reviewHref && state.read) router.push(reviewHref);
  }, [reviewHref, state.read, router]);

  const show = (list: FileList | null) => setFiles(list ? Array.from(list) : []);

  const accept = (dropped: FileList) => {
    const input = inputRef.current;
    if (!input) return;

    // Assigning through a DataTransfer is the only way to put dropped files on
    // an input, and the input is what the form actually posts.
    const transfer = new DataTransfer();
    for (const file of Array.from(dropped).slice(0, MAX_FILES)) transfer.items.add(file);

    input.files = transfer.files;
    show(input.files);
  };

  const remove = (index: number) => {
    const input = inputRef.current;
    if (!input?.files) return;

    const transfer = new DataTransfer();
    Array.from(input.files).forEach((file, i) => {
      if (i !== index) transfer.items.add(file);
    });

    input.files = transfer.files;
    show(input.files);
  };

  return (
    <form action={action} className="space-y-4 px-5 py-5">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
          dragging
            ? 'border-brand-500 bg-brand-50'
            : 'border-ink-300 bg-ink-50/60 hover:border-brand-400 hover:bg-brand-50/40'
        }`}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className={`h-9 w-9 ${dragging ? 'text-brand-600' : 'text-ink-400'}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4 4 4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>

        <p className="text-sm font-medium text-ink-900">{t.upload.dropHere}</p>
        <p className="text-xs text-ink-500">{t.upload.dropHint}</p>

        <input
          ref={inputRef}
          type="file"
          name="files"
          multiple
          accept={ACCEPT}
          onChange={(event) => show(event.target.files)}
          onClick={(event) => event.stopPropagation()}
          className="sr-only"
        />
      </div>

      {files.length > 0 ? (
        <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="truncate text-ink-800">{file.name}</span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="tabular text-xs text-ink-500">{humanSize(file.size)}</span>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="inline-flex min-h-11 items-center sm:min-h-0 text-sm text-ink-500 underline transition hover:text-red-600 sm:text-xs"
                >
                  {t.upload.remove}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {t.upload.errors[state.error] ?? state.error}
        </p>
      ) : null}

      {state.read ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {t.upload.readDone(state.read, state.needsAttention ?? 0)}
        </p>
      ) : null}

      <Submit count={files.length} />
    </form>
  );
}
