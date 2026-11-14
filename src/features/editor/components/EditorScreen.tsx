import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Info,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  RefreshCw,
  Save,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import type { EditorAggregateResponse } from '@/api/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, type ButtonProps } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { PartialAnalysisBanner, StartAnalysisButton } from '@/features/analysis';
import { DocumentStatusBadge } from '@/features/documents';
import { nextInGroup } from '@/domain/editor/groups';
import { cn } from '@/lib/cn';
import { getErrorMessage } from '@/lib/errors';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';

import { useDocumentFile } from '../hooks/useDocumentFile';
import { flagMarkId, markTarget, pdfMarks, suggestionMarkId } from '../lib/pdfMarks';
import { useResetDecisions, useResetReview } from '../hooks/useEditor';
import { EDITOR_TEXTS } from '../model/texts';
import { initialViewMode, useEditorModel, type ViewMode } from '../model/useEditorModel';

import { DocumentText } from './DocumentText';
import { DocxSuggestionsView } from './DocxSuggestionsView';
import { FlagsSection } from './FlagsSection';
import { ExportButton } from './ExportButton';
import { LeaveGuard } from './LeaveGuard';
import { MarkdownDocument } from './MarkdownDocument';
import { OriginalDocxView } from './OriginalDocxView';
import { PdfDocumentView } from './PdfDocumentView';
import { SuggestionDetails } from './SuggestionDetails';
import { SuggestionsPanel, type PanelDecision } from './SuggestionsPanel';

interface EditorScreenProps {
  projectId: string;
  editor: EditorAggregateResponse;
  refetch: () => Promise<unknown>;
}

// По макету иконка только у «Правок».
const MODE_OPTIONS: { value: ViewMode; label: string; icon?: React.ReactNode }[] = [
  { value: 'original', label: 'Оригинал' },
  { value: 'suggestions', label: 'Правки', icon: <PenLine aria-hidden /> },
  { value: 'clean', label: 'Чистовик' },
];

/** Та же точка, что и lg: у сетки редактора — с неё карточка «парит» над текстом у правки. */
const DESKTOP_QUERY = '(min-width: 1024px)';
/** С md: элементы шапки полного размера, ниже — компактные. */
const TABLET_QUERY = '(min-width: 768px)';
/** Ширина парящей карточки по макету (34rem); на узкой статье ужимается до её правого края. */
const CARD_WIDTH = 544;
/** Зазор между блоком правки и карточкой. */
const CARD_GAP = 8;
/** Состояние выдвижной панели переживает перезагрузку — как у бокового меню. */
const PANEL_STORAGE_KEY = 'syncscribe.editor.suggestionsPanel';

function readPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(PANEL_STORAGE_KEY) !== 'closed';
  } catch {
    return true;
  }
}

function writePanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(PANEL_STORAGE_KEY, open ? 'open' : 'closed');
  } catch {
    // Хранилище недоступно (приватный режим, квота) — состояние живёт только в сессии.
  }
}

interface FloatingBox {
  top: number;
  left: number;
  width: number;
}

export function EditorScreen({ projectId, editor, refetch }: EditorScreenProps) {
  const model = useEditorModel(projectId, editor, refetch);
  const { meta, status, permissions, progress, decisions, undoBuffered, decideSuggestion } = model;
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<ViewMode>(() => initialViewMode(meta.view_mode));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFlagId, setSelectedFlagId] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState<boolean>(readPanelOpen);
  const resetReview = useResetReview(projectId, meta.id);
  const resetDecisions = useResetDecisions(projectId, meta.id);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const tablet = useMediaQuery(TABLET_QUERY);
  const headerRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState<FloatingBox | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    writePanelOpen(panelOpen);
  }, [panelOpen]);

  const togglePanel = useCallback(() => setPanelOpen((open) => !open), []);

  // Шторка липнет ровно к низу sticky-шапки. Её высота зависит от ширины окна (перенос группы
  // действий на вторую строку), поэтому измеряется, а не зашита в классах: фиксированный top
  // оставлял при прокрутке зазор между шапкой и панелью и выталкивал низ панели за экран.
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return undefined;
    const update = () => setHeaderHeight(header.offsetHeight);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // Word-документ рисуется из самого файла во всех режимах: в «Оригинале» как есть,
  // в «Правках» и «Чистовике» — с правками поверх рендера docx-preview.
  const isDocx = meta.format === 'docx';
  // Markdown-документ рисуется в исходном форматировании (значение формата на бэкенде markdown).
  const isMarkdown = meta.format.toLowerCase() === 'markdown';
  // PDF не перевёрстывается: во всех режимах исходные страницы, режим меняет только отметки.
  const isPdf = meta.format.toLowerCase() === 'pdf';
  const file = useDocumentFile(projectId, meta.id, isDocx || isPdf);

  const headerSize: ButtonProps['size'] = tablet ? 'default' : 'sm';
  const projection = mode === 'clean' ? model.projections.clean : model.projections.suggestions;
  // В «Оригинале» правок нет — карточка предложения там не показывается вовсе.
  const selected =
    mode === 'original' ? null : (model.suggestions.find((s) => s.id === selectedId) ?? null);
  const unsavedIds = useMemo(() => new Set(Object.keys(decisions)), [decisions]);

  // Выбор из панели в «Оригинале» переключает в «Правки» — иначе показать правку негде.
  const selectFromPanel = useCallback((id: string) => {
    setMode((current) => (current === 'original' ? 'suggestions' : current));
    setSelectedId(id);
    // Прокручиваем после отрисовки выделения; в jsdom scrollIntoView нет.
    requestAnimationFrame(() => {
      const target = Array.from(
        document.querySelectorAll<HTMLElement>('[data-suggestion-id]'),
      ).find((element) => element.dataset.suggestionId === id);
      target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    });
  }, []);

  // Флаг выбран в тексте — показываем его карточку в панели; выбор в панели — прокручиваем к блоку.
  // В «Чистовике» флагов нет, поэтому выбор из панели переключает в «Правки».
  const selectFlagInText = useCallback((id: string) => {
    setSelectedFlagId(id);
    setPanelOpen(true);
    requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-flag-card-id]')).find(
        (element) => element.dataset.flagCardId === id,
      );
      target?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  }, []);

  const selectFlagInPanel = useCallback((id: string) => {
    setMode((current) => (current === 'clean' ? 'suggestions' : current));
    setSelectedFlagId((current) => (current === id ? null : id));
    requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-flag-id]')).find(
        (element) => element.dataset.flagId === id,
      );
      target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    });
  }, []);

  // Флаг исчез после нового анализа — снимаем выбор, чтобы не держать ссылку на чужой id.
  useEffect(() => {
    if (selectedFlagId && !model.flags.some((flag) => flag.id === selectedFlagId)) {
      setSelectedFlagId(null);
    }
  }, [selectedFlagId, model.flags]);

  // Быстрое решение кнопками в списке панели: то же, что из карточки, без правки текста.
  const decideFromPanel = useCallback(
    (id: string, decision: PanelDecision) => {
      decideSuggestion(id, decision);
      setSelectedId(null);
    },
    [decideSuggestion],
  );

  // Отмена решения: из карточки, кнопкой на блоке в тексте и при наведении в панели.
  // Несохранённое снимается локально, сохранённое — запросом на бэкенд.
  const undo = useCallback(
    (id: string) => {
      if (decisions[id]) {
        undoBuffered(id);
        return;
      }
      resetDecisions.mutate([id], { onError: (error) => toast.error(getErrorMessage(error)) });
    },
    [decisions, undoBuffered, resetDecisions],
  );

  // Выбранная правка исчезла (новый анализ) или открыт «Оригинал»: сбрасываем выбор.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  // На десктопе карточка «парит» над текстом рядом с выбранным блоком, не сдвигая ни текст, ни
  // панель. На узком экране и если фрагмент не найден — остаётся в правой панели.
  // У PDF своя прокрутка внутри области страниц, поэтому карточка остаётся в панели.
  const canFloat = desktop && selected !== null && !isPdf;

  // Считаем позицию относительно обёртки статьи. По умолчанию карточка под блоком; если снизу
  // она вышла бы за край статьи (и растянула страницу) — над блоком. Высота карточки
  // известна только после её отрисовки, поэтому замер повторяется, когда она появилась.
  const measure = useCallback(() => {
    const wrapper = textRef.current;
    if (!wrapper || !selectedId) return;
    const target = Array.from(wrapper.querySelectorAll<HTMLElement>('[data-suggestion-id]')).find(
      (element) => element.dataset.suggestionId === selectedId,
    );
    if (!target) {
      setFloating(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    const base = wrapper.getBoundingClientRect();
    const cardHeight = cardRef.current?.offsetHeight ?? 0;
    const left = Math.round(Math.max(0, rect.left - base.left));
    const width = Math.round(Math.min(CARD_WIDTH, base.width - left));
    const below = rect.bottom - base.top + CARD_GAP;
    const above = rect.top - base.top - CARD_GAP - cardHeight;
    const fitsBelow = below + cardHeight <= base.height;
    const top = Math.round(fitsBelow || above < 0 ? below : above);
    setFloating((prev) =>
      prev && prev.top === top && prev.left === left && prev.width === width
        ? prev
        : { top, left, width },
    );
  }, [selectedId]);

  useLayoutEffect(() => {
    if (!canFloat) {
      setFloating(null);
      return undefined;
    }
    measure();
    const wrapper = textRef.current;
    if (typeof ResizeObserver === 'undefined' || !wrapper) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [canFloat, measure, projection]);

  const popover = canFloat && floating !== null;

  // Карточка появилась или сменила высоту — перепроверяем, помещается ли она снизу, до отрисовки кадра.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!popover || !card) return undefined;
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [popover, measure]);

  const goBack = () => {
    // key 'default' у первой записи истории: страницу открыли по ссылке, назад некуда.
    if (location.key !== 'default') navigate(-1);
    else navigate(`/projects/${projectId}`);
  };

  const save = async () => {
    const outcome = await model.saveDecisions();
    if (outcome === 'saved') toast.success('Изменения сохранены');
    return outcome;
  };

  const completed = status === 'ready' && model.unsavedCount === 0;
  const liveStatus = liveStatusText({
    saving: model.saving,
    conflict: Boolean(model.conflict),
    error: Boolean(model.saveError),
    unsaved: model.unsavedCount,
  });

  // Повторная проверка живёт в панели, а не в шапке: в ready шапка и так самая плотная.
  const reanalyze =
    status === 'ready' ? (
      <StartAnalysisButton
        projectId={projectId}
        size="sm"
        document={{ id: meta.id, name: meta.title, status }}
      />
    ) : null;

  const decideGroup = model.decideGroup;
  const decideGroupFromPanel = useCallback(
    (groupKey: string, decision: PanelDecision) => {
      decideGroup(groupKey, decision);
      setSelectedId(null);
    },
    [decideGroup],
  );

  const selectedGroupKey = selected?.group_key ?? null;
  const selectedGroupIds = selectedGroupKey ? model.groups.get(selectedGroupKey) : undefined;
  const selectedGroupSize = selectedGroupKey ? model.groupSizes.get(selectedGroupKey) : undefined;
  const nextGroupId =
    selected && selectedGroupIds ? nextInGroup(selectedGroupIds, selected.id) : null;
  const selectedGroup =
    selected && selectedGroupKey && selectedGroupIds && selectedGroupSize
      ? {
          size: selectedGroupSize,
          pending: model.pendingInGroup(selectedGroupKey).length,
          onDecide: (decision: PanelDecision) => decideGroupFromPanel(selectedGroupKey, decision),
          onNext: nextGroupId ? () => selectFromPanel(nextGroupId) : null,
        }
      : undefined;

  const details = selected ? (
    <SuggestionDetails
      key={selected.id}
      suggestion={selected}
      status={model.statusOf(selected)}
      unsaved={unsavedIds.has(selected.id)}
      newText={model.newTextOf(selected)}
      located={projection.located[selected.id]}
      canReview={permissions.can_review}
      undoing={resetDecisions.isPending}
      onDecide={(decision, editedText) => {
        model.decideSuggestion(selected.id, decision, editedText);
        setSelectedId(null);
      }}
      onUndo={() => undo(selected.id)}
      onClose={() => setSelectedId(null)}
      group={selectedGroup}
    />
  ) : null;

  // Карточка не парит и панель свёрнута — показываем её над текстом, чтобы выбор не пропал.
  const detailsInPanel = !popover && panelOpen;
  const detailsAboveText = !popover && !panelOpen;

  const textProps = {
    mode,
    originalText: model.content.plain_text,
    segments: projection.segments,
    selectedId,
    onSelect: setSelectedId,
    onUndo: undo,
    flags: model.flagMarks,
    selectedFlagId,
    onSelectFlag: selectFlagInText,
  };
  const plainText = model.content.plain_text ? (
    isMarkdown ? (
      <MarkdownDocument {...textProps} />
    ) : (
      <DocumentText {...textProps} />
    )
  ) : (
    <p className="text-sm text-muted-foreground">Документ не содержит текста.</p>
  );

  const { statusOf } = model;
  const marks = useMemo(
    () =>
      isPdf ? pdfMarks({ mode, suggestions: model.suggestions, statusOf, flags: model.flags }) : [],
    [isPdf, mode, model.suggestions, statusOf, model.flags],
  );
  const markFocus = selected
    ? suggestionMarkId(selected.id)
    : selectedFlagId && mode === 'suggestions'
      ? flagMarkId(selectedFlagId)
      : null;
  const selectMark = useCallback(
    (markId: string) => {
      const target = markTarget(markId);
      if (target?.kind === 'suggestion') setSelectedId(target.id);
      else if (target?.kind === 'flag') selectFlagInText(target.id);
    },
    [selectFlagInText],
  );

  // Word: «Оригинал» — чистый рендер файла; «Правки»/«Чистовик» — тот же рендер с якорями правок.
  const article = isPdf ? (
    <PdfDocumentView
      file={file.data}
      loading={file.isLoading}
      error={file.error}
      highlights={marks}
      focus={markFocus}
      onHighlightClick={selectMark}
      pageSizes={model.content.pages ?? undefined}
      fallback={plainText}
    />
  ) : !isDocx ? (
    plainText
  ) : mode === 'original' ? (
    <OriginalDocxView
      file={file.data}
      loading={file.isLoading}
      error={file.error}
      fallback={plainText}
    />
  ) : (
    <DocxSuggestionsView
      file={file.data}
      loading={file.isLoading}
      error={file.error}
      mode={mode}
      suggestions={model.suggestions}
      sections={model.content.sections}
      blocks={model.blocks}
      plainText={model.content.plain_text}
      statusOf={model.statusOf}
      newTextOf={model.newTextOf}
      selectedId={selectedId}
      onSelect={setSelectedId}
      flags={model.flags}
      selectedFlagId={selectedFlagId}
      onSelectFlag={selectFlagInText}
      fallback={plainText}
    />
  );

  const panelToggleLabel = panelOpen ? 'Скрыть предложения ИИ' : 'Показать предложения ИИ';
  // На десктопе шторка занимает всё место от низа шапки до низа окна; ниже lg — обычный поток.
  const drawerStyle =
    desktop && headerHeight > 0
      ? { top: headerHeight, height: `calc(100vh - ${headerHeight}px)` }
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Шапка по макету: название держит минимальную ширину, группа действий при нехватке места
          переносится на вторую строку целиком, а не сжимает название и статус. */}
      <header
        ref={headerRef}
        className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background/95 px-4 py-2 backdrop-blur-sm md:-mx-8 md:px-8"
      >
        <Button size="icon" variant="ghost" onClick={goBack} aria-label="Назад">
          <ArrowLeft aria-hidden />
        </Button>
        <Divider className="hidden sm:block" />
        <div className="min-w-[12rem] flex-1">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate font-serif text-base font-medium tracking-tight md:text-lg">
              {meta.title}
            </h1>
            <DocumentStatusBadge status={status} dot className="shrink-0 font-semibold" />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
              <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
              {progress.pending} на рассмотрении
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              {progress.accepted} принято
            </span>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <SegmentedControl<ViewMode>
            sliding
            size={tablet ? 'md' : 'sm'}
            ariaLabel="Режим просмотра"
            value={mode}
            onChange={setMode}
            options={MODE_OPTIONS}
          />
          <Divider className="hidden sm:block" />
          <ExportButton
            projectId={projectId}
            documentId={meta.id}
            title={meta.title}
            format={meta.format}
            size={headerSize}
            enabled={permissions.can_export && model.unsavedCount === 0}
          />
          <SaveButton
            size={headerSize}
            canSave={model.canSave}
            saving={model.saving}
            onSave={() => void save()}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size={tablet ? 'icon' : 'iconSm'}
                variant="outline"
                aria-label="Дополнительные действия"
              >
                <MoreVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!(permissions.can_review || status === 'ready')}
                onSelect={() => setResetOpen(true)}
              >
                <RefreshCw aria-hidden />
                {EDITOR_TEXTS.resetTitle}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Divider className="hidden sm:block" />
          {/* Тоггл выдвижной панели; в свёрнутом виде напоминает, сколько правок ждут решения. */}
          <Button
            size={tablet ? 'icon' : 'iconSm'}
            variant="outline"
            className={cn('relative', panelOpen && 'bg-accent text-accent-foreground')}
            onClick={togglePanel}
            aria-label={panelToggleLabel}
            aria-expanded={panelOpen}
            aria-controls="suggestions-panel"
          >
            {panelOpen ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />}
            {!panelOpen && progress.pending > 0 ? (
              <span
                aria-hidden
                className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums leading-4 text-primary-foreground"
              >
                {progress.pending}
              </span>
            ) : null}
          </Button>
        </div>
      </header>

      {/* Озвучка состояния ревью для скринридеров; тексты не повторяют видимые баннеры. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveStatus}
      </div>

      {model.conflict ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>{EDITOR_TEXTS.conflictTitle}</AlertTitle>
          <AlertDescription>
            {EDITOR_TEXTS.conflictText}
            <span className="mt-1 block text-xs opacity-80">{model.conflict}</span>
          </AlertDescription>
          <Button size="sm" variant="outline" className="mt-2" onClick={model.dismissConflict}>
            Понятно
          </Button>
        </Alert>
      ) : null}
      {model.saveError ? (
        <Alert variant="destructive" role="alert">
          <TriangleAlert aria-hidden />
          <AlertTitle>Не удалось сохранить изменения</AlertTitle>
          <AlertDescription>{model.saveError}</AlertDescription>
        </Alert>
      ) : null}

      {/* flex вместо grid: при свёрнутой панели текст занимает всю ширину, а панель уезжает вправо. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <section aria-label="Текст документа" className="min-w-0 flex-1 space-y-3">
          <PartialAnalysisBanner projectId={projectId} document={{ ...meta, status }} />
          {mode === 'original' ? (
            <Alert>
              <Info aria-hidden />
              <AlertDescription>{EDITOR_TEXTS.originalNotice}</AlertDescription>
            </Alert>
          ) : null}
          {detailsAboveText ? details : null}
          <div ref={textRef} className="relative">
            <article className="rounded-lg border bg-card px-5 py-4 shadow-sm sm:px-8 sm:py-6 lg:px-10 lg:py-8">
              {article}
            </article>
            {popover ? (
              // z-[5] — ниже sticky-шапки (z-10): при прокрутке карточка уходит под неё.
              <div
                ref={cardRef}
                className="absolute z-[5]"
                style={{ top: floating.top, left: floating.left, width: floating.width }}
              >
                {details}
              </div>
            ) : null}
          </div>
        </section>

        {/* Выдвижная «шторка» по макету: на lg+ прижата к правому краю окна и к низу шапки
            (отрицательные отступы гасят поля страницы), с левой границей и собственным скроллом,
            который появляется только когда список не помещается. top/height считаются от измеренной
            шапки. Анимируются ширина и прозрачность (как у Sidebar); visibility убирает скрытую
            панель из порядка табуляции. На узких экранах — обычный блок под текстом, который просто скрывается. */}
        <div
          id="suggestions-panel"
          aria-hidden={!panelOpen}
          style={drawerStyle}
          className={cn(
            'relative shrink-0 lg:sticky lg:-mr-8 lg:-mt-4 lg:self-start',
            'transition-[width,opacity,transform,visibility] duration-300 ease-in-out motion-reduce:transition-none',
            panelOpen
              ? 'visible translate-x-0 opacity-100 lg:w-[20rem] lg:border-l lg:bg-card xl:w-[23rem]'
              : 'hidden lg:invisible lg:block lg:w-0 lg:translate-x-6 lg:overflow-hidden lg:opacity-0',
          )}
        >
          {/* Хэндл на левой кромке — второй способ свернуть панель, как на макете. */}
          <button
            type="button"
            onClick={togglePanel}
            aria-label={panelToggleLabel}
            aria-expanded={panelOpen}
            aria-controls="suggestions-panel"
            tabIndex={panelOpen ? 0 : -1}
            className="absolute left-1 top-4 z-10 hidden h-64 w-1.5 rounded-full bg-border transition-colors hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:block"
          />
          <div className="lg:h-full lg:w-[20rem] lg:overflow-y-auto lg:overscroll-contain lg:px-7 lg:py-6 xl:w-[23rem]">
            <SuggestionsPanel
              suggestions={model.suggestions}
              statusOf={model.statusOf}
              unsavedIds={unsavedIds}
              located={projection.located}
              progress={progress}
              selectedId={selectedId}
              onSelect={selectFromPanel}
              canReview={permissions.can_review}
              onDecide={decideFromPanel}
              onUndo={undo}
              groupSizes={model.groupSizes}
              onDecideGroup={decideGroupFromPanel}
              header={
                <>
                  {completed ? (
                    <Alert variant="success">
                      <CheckCircle2 aria-hidden />
                      <AlertDescription className="space-y-2">
                        <p>{EDITOR_TEXTS.completed}</p>
                        {reanalyze ? <span className="flex">{reanalyze}</span> : null}
                      </AlertDescription>
                    </Alert>
                  ) : (
                    reanalyze
                  )}
                  {detailsInPanel ? details : null}
                  <FlagsSection
                    projectId={projectId}
                    documentId={meta.id}
                    flags={model.flags}
                    pending={model.flagsPending}
                    canMark={status === 'awaiting_approval' || status === 'ready'}
                    selectedId={selectedFlagId}
                    onSelect={selectFlagInPanel}
                  />
                </>
              }
            />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={(open) => {
          setResetOpen(open);
          if (!open) resetReview.reset();
        }}
        title={EDITOR_TEXTS.resetTitle}
        description={EDITOR_TEXTS.resetText}
        confirmLabel="Сбросить"
        destructive
        loading={resetReview.isPending}
        error={resetReview.error ? getErrorMessage(resetReview.error) : null}
        onConfirm={() =>
          resetReview.mutate(undefined, {
            onSuccess: () => {
              model.clearBuffer();
              setResetOpen(false);
              toast.success('Решения сброшены');
            },
          })
        }
      />

      <LeaveGuard
        dirty={model.unsavedCount > 0}
        saving={model.saving}
        saveError={model.saveError}
        onSave={save}
        onDiscard={model.clearBuffer}
      />
    </div>
  );
}

/** Вертикальный разделитель групп в шапке. */
function Divider({ className }: { className?: string }) {
  return <span aria-hidden className={cn('h-8 w-px shrink-0 bg-border', className)} />;
}

interface LiveStatusInput {
  saving: boolean;
  conflict: boolean;
  error: boolean;
  unsaved: number;
}

/** Короткое сообщение для aria-live: одно состояние за раз, без дублирования баннеров. */
function liveStatusText({ saving, conflict, error, unsaved }: LiveStatusInput): string {
  if (saving) return 'Идёт сохранение решений';
  if (conflict) return 'Загружена актуальная версия документа, буфер решений сохранён';
  if (error) return 'Сохранение завершилось ошибкой';
  if (unsaved > 0) return `Несохранённых решений: ${unsaved}`;
  return '';
}

function SaveButton({
  canSave,
  saving,
  onSave,
  size = 'sm',
}: {
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  size?: ButtonProps['size'];
}) {
  if (!canSave && !saving) {
    return (
      <Button size={size} variant="outline" disabled>
        <Check aria-hidden />
        Сохранено
      </Button>
    );
  }
  return (
    <Button size={size} loading={saving} onClick={onSave}>
      <Save aria-hidden />
      Сохранить
    </Button>
  );
}
