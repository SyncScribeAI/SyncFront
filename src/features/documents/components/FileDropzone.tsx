import { FileUp, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  acceptAttribute,
  type UploadRules,
  validateUploadFile,
} from '@/domain/upload/fileValidation';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';

import { DocumentFormatIcon } from './DocumentFormatIcon';

interface FileDropzoneProps {
  rules: UploadRules;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

/** Выбор файла кликом, клавиатурой или перетаскиванием; проверка по правилам capabilities. */
export function FileDropzone({ rules, file, onChange, disabled = false }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = (next: File | undefined) => {
    if (!next) return;
    const result = validateUploadFile(next, rules);
    if (result.ok) {
      setError(null);
      onChange(next);
    } else {
      setError(result.message);
      onChange(null);
    }
  };

  const clear = () => {
    onChange(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  if (file) {
    return (
      <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border bg-card p-3">
        <DocumentFormatIcon format={file.name.split('.').pop() ?? ''} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Убрать файл"
          disabled={disabled}
          onClick={clear}
        >
          <X aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={disabled}
        aria-describedby={hintId}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files[0]);
        }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors duration-150',
          dragging
            ? 'border-primary bg-accent'
            : 'border-input hover:border-primary/60 hover:bg-muted/50',
          error && 'border-destructive/60',
        )}
      >
        <FileUp className="size-6 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">Перетащите файл сюда или нажмите, чтобы выбрать</span>
        <span id={hintId} className="text-xs text-muted-foreground">
          {rules.extensions.join(', ')} · до {rules.maxSizeMb} МБ
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Файл документа"
        accept={acceptAttribute(rules.extensions)}
        onChange={(event) => accept(event.target.files?.[0])}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
