/** Цвета правок и флагов в тексте документа: общие для текстового и Markdown-режима. */
import { Check, Pencil, X } from 'lucide-react';

import type { ChangeType } from '@/domain/editor/suggestion';

// Заголовок нерассмотренной блочной правки по макету: иконка и глагол. Доступное имя даёт changeTypeMeta.
export const PENDING_HEADER: Record<ChangeType, { verb: string; Icon: typeof Pencil }> = {
  modify: { verb: 'Изменить', Icon: Pencil },
  add: { verb: 'Добавить', Icon: Check },
  delete: { verb: 'Удалить', Icon: X },
};

// Нерассмотренные правки окрашены цветом типа: рамка и левая полоса блока, инлайновая подсветка,
// заголовок и зачёркнутый старый текст.
export const pendingTone = {
  modify: {
    block: 'border border-l-4 border-amber-300 border-l-amber-400 bg-amber-50/50',
    inline: 'bg-amber-50 ring-1 ring-amber-300',
    header: 'text-amber-800',
    old: 'text-amber-700/80 decoration-amber-600',
  },
  delete: {
    block: 'border border-l-4 border-red-200 border-l-red-400 bg-red-50/50',
    inline: 'bg-red-50 ring-1 ring-red-200',
    header: 'text-red-700',
    old: 'text-red-700/80 decoration-red-600',
  },
  add: {
    block: 'border border-l-4 border-emerald-200 border-l-emerald-400 bg-emerald-50/50',
    inline: 'bg-emerald-50 ring-1 ring-emerald-200',
    header: 'text-emerald-700',
    old: '',
  },
} as const;

// Принятые в «Правках»: изменение и добавление показаны зелёным блоком с новым текстом, удаление зачёркнуто.
export const acceptedTone = {
  modify: { block: 'border-l-4 border-l-emerald-400 bg-emerald-50/60', inline: 'bg-emerald-50' },
  add: { block: 'border-l-4 border-l-emerald-400 bg-emerald-50/60', inline: 'bg-emerald-50' },
  delete: { block: 'bg-red-50/40', inline: '' },
} as const;

// Отклонённые в «Правках»: исходный текст без акцента, но блок остаётся кликабельным.
export const rejectedTone = {
  block: 'border-l-4 border-l-border bg-muted/30',
  inline: 'bg-muted/40',
};

// Рассмотренные в «Чистовике» выглядят обычным текстом; подсветка при наведении подсказывает, что решение можно отменить.
export const quietTone = { block: 'hover:bg-muted/30', inline: 'hover:bg-muted/40' };

// Флаг не правка, поэтому у него не цвета changeTypeMeta, а пунктирная рамка слева.
export const FLAG_MARK_CLASS =
  'cursor-pointer rounded-sm border-l-2 border-dashed border-sky-500 bg-sky-50/70 box-decoration-clone pl-1 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring';
