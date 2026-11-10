import { Copy, Sparkles } from 'lucide-react';

import type { SuggestionResponse } from '@/api/types';
import { Badge } from '@/components/ui/badge';

import { GROUP_TEXTS } from '../model/texts';

/** Сколько ещё правок той же фразы; группа из одной правки бейджа не получает. */
export function GroupBadge({ size }: { size: number | undefined }) {
  if (!size || size < 2) return null;
  return (
    <Badge className="bg-indigo-50 text-indigo-800 ring-indigo-200">
      <Copy className="size-3" aria-hidden />
      {GROUP_TEXTS.more(size - 1)}
    </Badge>
  );
}

/** Правку нашёл бэкенд по точному повтору фразы, а не модель — пользователю стоит знать. */
export function PropagatedBadge({ origin }: { origin: SuggestionResponse['origin'] | undefined }) {
  if (origin !== 'propagated') return null;
  return (
    <Badge className="bg-slate-100 text-slate-700 ring-slate-200">
      <Sparkles className="size-3" aria-hidden />
      {GROUP_TEXTS.propagated}
    </Badge>
  );
}
