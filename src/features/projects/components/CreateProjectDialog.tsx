import { useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { queryKeys } from '@/api/queryKeys';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { SourceDraft } from '@/domain/source/sourceDraft';
import {
  createSourcesFromDrafts,
  SourceDraftForm,
  SourceTypeIcon,
  type SourceDraftFormHandle,
} from '@/features/sources';
import { getErrorMessage } from '@/lib/errors';

import { useCreateProject } from '../hooks/useProjects';
import { projectFormSchema, type ProjectFormValues } from '../model/schemas';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Создание проекта с базовыми источниками. Сначала создаётся проект, затем источники;
 * если какой-то источник не добавился, проект уже существует — сообщаем об этом честно
 * и всё равно открываем его страницу, где источник можно добавить повторно.
 */
export function CreateProjectDialog({ open, onOpenChange }: CreateProjectDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sourceForm = useRef<SourceDraftFormHandle>(null);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const create = useCreateProject();
  const [drafts, setDrafts] = useState<SourceDraft[]>([]);
  const [savingSources, setSavingSources] = useState(false);
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: { name: '', description: '' },
  });

  const busy = submitting || create.isPending || savingSources;
  const nameFilled = form.watch('name').trim().length > 0;

  const close = (next: boolean) => {
    if (busy || submittingRef.current) return;
    if (!next) {
      form.reset();
      setDrafts([]);
      create.reset();
    }
    onOpenChange(next);
  };

  const submit = form.handleSubmit(async ({ name, description }) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const pending = await sourceForm.current?.collectPending();
      if (!pending) return;
      const sources = [...drafts, ...pending];
      let projectId: string;
      try {
        const project = await create.mutateAsync({ name, description: description || null });
        projectId = project.id;
      } catch {
        return;
      }

      if (sources.length > 0) {
        setSavingSources(true);
        const { failed } = await createSourcesFromDrafts(projectId, { scope: 'project' }, sources);
        // Project creation invalidates too early: refresh counts after sources are persisted.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
          queryClient.invalidateQueries({ queryKey: queryKeys.sources.all }),
        ]);
        if (failed.length > 0) {
          toast.warning('Проект создан, но часть источников не добавилась', {
            description: failed.map((f) => `«${f.draft.name}»: ${f.message}`).join('\n'),
            duration: 10_000,
          });
        } else {
          toast.success('Проект создан');
        }
      } else {
        toast.success('Проект создан');
      }

      form.reset();
      setDrafts([]);
      create.reset();
      onOpenChange(false);
      navigate(`/projects/${projectId}`);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      setSavingSources(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-xl">
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Новый проект</DialogTitle>
            <DialogDescription>
              Проект объединяет документы и базовые источники истины, общие для всех документов.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Название проекта" error={form.formState.errors.name?.message}>
            <Input autoFocus maxLength={255} disabled={busy} {...form.register('name')} />
          </FormField>
          <FormField
            label="Описание"
            hint="Необязательно"
            error={form.formState.errors.description?.message}
          >
            <Textarea rows={2} maxLength={2000} disabled={busy} {...form.register('description')} />
          </FormField>

          <section aria-labelledby="create-project-sources" className="space-y-3">
            <div>
              <h3 id="create-project-sources" className="text-sm font-medium">
                Базовые источники истины
              </h3>
              <p className="text-xs text-muted-foreground">
                Используются при анализе каждого документа проекта. Заполненный источник сохранится
                при создании проекта. Можно добавить позже.
              </p>
            </div>
            {drafts.length > 0 ? (
              <ul className="divide-y rounded-md border">
                {drafts.map((draft) => (
                  <li key={draft.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <SourceTypeIcon type={draft.kind === 'url' ? 'url' : 'file'} />
                    <span className="min-w-0 flex-1 truncate">{draft.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={busy}
                      aria-label={`Убрать источник ${draft.name}`}
                      onClick={() => setDrafts((list) => list.filter((d) => d.id !== draft.id))}
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="rounded-md border border-dashed p-3">
              <SourceDraftForm
                ref={sourceForm}
                disabled={busy}
                onSubmit={(draft) => {
                  setDrafts((list) => [...list, draft]);
                  return true;
                }}
              />
            </div>
          </section>

          {create.error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{getErrorMessage(create.error)}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => close(false)}>
              Отмена
            </Button>
            <Button type="submit" loading={busy} disabled={!nameFilled}>
              {savingSources ? 'Добавляем источники…' : 'Создать проект'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
