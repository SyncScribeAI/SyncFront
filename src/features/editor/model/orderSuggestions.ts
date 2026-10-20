import type { SuggestionResponse } from '@/api/types';
import type { LocatedSuggestion } from '@/domain/editor/projection';

/**
 * Позиционные правки идут по документу; непривязанные — стабильно после них.
 * Если у обеих правок есть documentOrder, он точнее смещения (разводит несколько add в одной точке).
 */
export function orderSuggestions(
  suggestions: readonly SuggestionResponse[],
  located: Record<string, LocatedSuggestion>,
): SuggestionResponse[] {
  return suggestions
    .map((suggestion, index) => ({
      suggestion,
      index,
      offset: located[suggestion.id]?.originOffset,
      order: located[suggestion.id]?.documentOrder,
    }))
    .sort((a, b) => {
      const aLocated = typeof a.offset === 'number';
      const bLocated = typeof b.offset === 'number';
      if (aLocated && bLocated) {
        const position =
          typeof a.order === 'number' && typeof b.order === 'number'
            ? a.order - b.order
            : Number(a.offset) - Number(b.offset);
        return position || a.index - b.index;
      }
      if (aLocated) return -1;
      if (bLocated) return 1;
      return a.index - b.index;
    })
    .map(({ suggestion }) => suggestion);
}
