import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertCircle } from 'lucide-react';

import { cn } from '@/lib/cn';

import { Alert, AlertDescription } from './alert';
import { Button } from './button';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  /** Ошибка последней попытки: окно остаётся открытым, данные не меняются. */
  error?: string | null;
  /** Дополнительные поля под описанием, например переключатель режима. */
  children?: React.ReactNode;
  onConfirm: () => void;
}

/** Подтверждение необратимого действия; фокус по умолчанию — на «Отмена». */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Отмена',
  destructive = false,
  loading = false,
  error,
  children,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-card p-6 shadow-lg',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
        >
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted-foreground">
            {description}
          </AlertDialog.Description>
          {children}
          {error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={loading}>
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
