import { AlertCircle, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { startAnalysis } from '@/api/resources/analysis';
import { uploadProjectDocument } from '@/api/resources/documents';
import type { DocumentResponse } from '@/api/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import type { SourceDraft } from '@/domain/source/sourceDraft';
import {
  createSourceFromDraft,
  SourceDraftForm,
  SourceList,
  SourceTypeIcon,
} from '@/features/sources';
import { useUploadRules } from '@/features/system';
import { uuidV4 } from '@/lib/id';

import { useBaseSources, useInvalidateDocuments, useProjectOptions } from '../hooks/useDocuments';
import { runUploadFlow, type UploadFlowResult } from '../model/uploadFlow';

import { FileDropzone } from './FileDropzone';
import { UploadStepper } from './UploadStepper';

interface UploadDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Если задан — проект выбран заранее (диалог открыт со страницы проекта). */
  projectId?: string;
}

type Stage = 'file' | 'sources';

const flowApi = {
  upload: uploadProjectDocument,
  createSource: createSourceFromDraft,
  startAnalysis: (projectId: string, documentId: string) =>
    startAnalysis({ projectId, documentId, idempotencyKey: uuidV4() }),
};

/** Диалог анализ не запускает, поэтому показывает только проблемы загрузки и источников. */
type FlowProblemResult = Exclude<UploadFlowResult, { kind: 'started' } | { kind: 'saved' }>;

/**
 * Загрузка документа в два шага: файл → специфичные источники → «Сохранить».
 * Документ добавляется в проект черновиком; анализ запускается отдельно кнопкой ▶ в строке
 * документа или «Анализом всех документов».
 */
export function UploadDocumentDialog({
  open,
  onOpenChange,
  projectId: fixedProjectId,
}: UploadDocumentDialogProps) {
  const rules = useUploadRules();
  const invalidate = useInvalidateDocuments();
  const projects = useProjectOptions(open && !fixedProjectId);

  const [stage, setStage] = useState<Stage>('file');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [drafts, setDrafts] = useState<SourceDraft[]>([]);
  const [uploaded, setUploaded] = useState<DocumentResponse | null>(null);
  const [problem, setProblem] = useState<FlowProblemResult | null>(null);
  const [running, setRunning] = useState(false);

  const projectId = fixedProjectId ?? selectedProjectId;
  const baseSources = useBaseSources(stage === 'sources' && projectId ? projectId : null);

  const reset = () => {
    setStage('file');
    setSelectedProjectId('');
    setFile(null);
    setDrafts([]);
    setUploaded(null);
    setProblem(null);
  };

  const close = () => {
    if (running) return;
    onOpenChange(false);
    reset();
  };

  const save = async () => {
    if (!file || !projectId) return;
    setRunning(true);
    const outcome = await runUploadFlow(flowApi, {
      projectId,
      file,
      drafts,
      uploaded,
      runAnalysis: false,
    });
    setRunning(false);
    if (outcome.kind !== 'upload_failed') {
      setUploaded(outcome.document);
      void invalidate(projectId);
    }
    if (outcome.kind === 'saved') {
      toast.success(`«${outcome.document.name}» добавлен как черновик`);
      onOpenChange(false);
      reset();
      return;
    }
    if (outcome.kind === 'sources_failed') {
      // Созданные источники больше не черновики: при повторе отправим только оставшиеся.
      setDrafts(outcome.failed.map((f) => f.draft));
    }
    if (outcome.kind !== 'started') setProblem(outcome);
  };

  const projectName = projects.data?.items.find((p) => p.id === projectId)?.name ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-xl" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Загрузка документа</DialogTitle>
          <DialogDescription>
            Документ будет добавлен в проект как черновик. Проверку по источникам истины запускает
            кнопка ▶ в строке документа.
          </DialogDescription>
        </DialogHeader>

        <UploadStepper current={stage === 'file' ? 0 : 1} />

        {stage === 'file' ? (
          <div className="grid gap-4">
            {!fixedProjectId ? (
              <div className="space-y-2">
                <Label htmlFor="upload-project">Проект</Label>
                {projects.isPending ? (
                  <Skeleton className="h-9" />
                ) : projects.data && projects.data.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Сначала создайте проект в разделе «Проекты».
                  </p>
                ) : (
                  <select
                    id="upload-project"
                    value={selectedProjectId}
                    disabled={Boolean(uploaded)}
                    onChange={(event) => setSelectedProjectId(event.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-sm disabled:opacity-60"
                  >
                    <option value="" disabled>
                      Выберите проект
                    </option>
                    {projects.data?.items.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : null}
            <div className="min-w-0 space-y-2">
              <span className="text-sm font-medium">Файл</span>
              {rules ? (
                <FileDropzone
                  rules={rules}
                  file={file}
                  onChange={setFile}
                  disabled={Boolean(uploaded)}
                />
              ) : (
                <Skeleton className="h-32" />
              )}
            </div>
          </div>
        ) : (
          <div className="grid min-w-0 gap-5">
            <section className="min-w-0 space-y-2" aria-labelledby="upload-base-sources">
              <h3 id="upload-base-sources" className="text-sm font-medium">
                Базовые источники проекта{projectName ? ` «${projectName}»` : ''}
              </h3>
              <p className="text-xs text-muted-foreground">
                Подключаются к документу автоматически.
              </p>
              {baseSources.isPending ? (
                <Skeleton className="h-10" />
              ) : baseSources.data && baseSources.data.length > 0 ? (
                <SourceList items={baseSources.data} className="max-h-40 overflow-y-auto" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  В проекте нет базовых источников. Анализ будет опираться только на специфичные.
                </p>
              )}
            </section>
            <section className="min-w-0 space-y-2" aria-labelledby="upload-doc-sources">
              <h3 id="upload-doc-sources" className="text-sm font-medium">
                Специфичные источники документа
              </h3>
              <p className="text-xs text-muted-foreground">
                Необязательно. Применяются только к этому документу.
              </p>
              {drafts.length > 0 ? (
                <ul className="min-w-0 divide-y rounded-md border">
                  {drafts.map((draft) => (
                    <li
                      key={draft.id}
                      className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm"
                    >
                      <SourceTypeIcon type={draft.kind === 'url' ? 'url' : 'file'} />
                      <span className="min-w-0 flex-1 truncate" title={draft.name}>
                        {draft.name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={running}
                        aria-label={`Убрать источник ${draft.name}`}
                        onClick={() => setDrafts((list) => list.filter((d) => d.id !== draft.id))}
                      >
                        <X aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="min-w-0 rounded-md border border-dashed p-3">
                <SourceDraftForm
                  disabled={running}
                  onSubmit={(draft) => {
                    setDrafts((list) => [...list, draft]);
                    return true;
                  }}
                />
              </div>
            </section>
          </div>
        )}

        {problem ? <FlowProblem result={problem} /> : null}

        <DialogFooter>
          {stage === 'file' ? (
            <>
              <Button variant="outline" onClick={close}>
                Отмена
              </Button>
              <Button disabled={!file || !projectId} onClick={() => setStage('sources')}>
                Далее
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={running} onClick={() => setStage('file')}>
                Назад
              </Button>
              <Button loading={running} onClick={() => void save()}>
                Сохранить
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FlowProblem({ result }: { result: FlowProblemResult }) {
  if (result.kind === 'upload_failed') {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Документ не загружен</AlertTitle>
        <AlertDescription className="whitespace-pre-line">{result.message}</AlertDescription>
      </Alert>
    );
  }
  if (result.kind === 'sources_failed') {
    return (
      <Alert variant="warning">
        <AlertCircle />
        <AlertTitle>Документ загружен, но часть источников не добавилась</AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-4">
            {result.failed.map((f) => (
              <li key={f.draft.id}>
                «{f.draft.name}»: {f.message}
              </li>
            ))}
          </ul>
          Документ уже сохранён как черновик. Исправьте или уберите источник и нажмите «Сохранить»
          ещё раз.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="warning">
      <AlertCircle />
      <AlertTitle>Документ сохранён, но анализ не запущен</AlertTitle>
      <AlertDescription>
        {result.message}. Запустите анализ кнопкой ▶ в строке документа.
      </AlertDescription>
    </Alert>
  );
}
