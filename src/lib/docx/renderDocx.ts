import { cn } from '@/lib/cn';

/**
 * Рендер .docx в HTML библиотекой docx-preview. Библиотека грузится лениво: она нужна
 * только для Word-файлов, в редакторе документа и в просмотре источника.
 */
export async function renderDocx(blob: Blob, container: HTMLElement): Promise<void> {
  const { renderAsync } = await import('docx-preview');
  await renderAsync(blob, container, undefined, {
    className: 'docx',
    // Без «листов» фиксированной ширины: текст течёт по ширине статьи, как и остальные режимы.
    inWrapper: false,
    ignoreWidth: true,
    ignoreHeight: true,
    breakPages: false,
    ignoreLastRenderedPageBreak: true,
    renderHeaders: false,
    renderFooters: false,
    useBase64URL: true,
  });
}

// Стили контейнера рендера. Tailwind-preflight обнуляет рамки у всех элементов, а docx-preview
// не всегда переводит рамки из стиля таблицы в CSS, поэтому у таблиц есть запасные рамки.
// Явные inline-рамки из документа имеют приоритет над этими классами.
export const DOCX_HOST_CLASS = cn(
  'docx-host',
  '[&_.docx]:!min-h-0 [&_.docx]:!w-auto [&_.docx]:!bg-transparent [&_.docx]:!p-0 [&_.docx]:!shadow-none',
  '[&_.docx_table]:my-3 [&_.docx_table]:w-full [&_.docx_table]:border-collapse',
  '[&_.docx_td]:border [&_.docx_td]:border-border [&_.docx_td]:px-2 [&_.docx_td]:py-1 [&_.docx_td]:align-top',
  '[&_.docx_th]:border [&_.docx_th]:border-border [&_.docx_th]:px-2 [&_.docx_th]:py-1 [&_.docx_th]:align-top',
);
