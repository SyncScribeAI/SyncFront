/**
 * Группы правок одной фразы (group_key): одна и та же исправляемая формулировка в разных местах
 * документа. Сервер хранит group_key только у групп из двух и более правок.
 */

export interface GroupMember {
  id: string;
  group_key?: string | null;
}

/**
 * id правок каждой группы в переданном порядке — один проход, O(S). Порядок задаёт вызывающий:
 * для навигации «следующее вхождение» это порядок документа (orderSuggestions).
 */
export function groupIndex(ordered: readonly GroupMember[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const suggestion of ordered) {
    const key = suggestion.group_key;
    if (!key) continue;
    const ids = index.get(key);
    if (ids) ids.push(suggestion.id);
    else index.set(key, [suggestion.id]);
  }
  return index;
}

/**
 * Размеры групп. suggestion_groups сервера считается по всем правкам анализа, а не по
 * загруженной странице, поэтому важнее локального подсчёта; без него — размер по индексу.
 */
export function groupSizes(
  serverGroups: readonly { group_key: string; size: number }[] | undefined,
  index: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  if (serverGroups && serverGroups.length > 0) {
    return new Map(serverGroups.map((group) => [group.group_key, group.size]));
  }
  return new Map(Array.from(index, ([key, ids]) => [key, ids.length]));
}

/** Следующая правка группы после текущей; с последней — снова первая. */
export function nextInGroup(ids: readonly string[], currentId: string): string | null {
  if (ids.length < 2) return null;
  const at = ids.indexOf(currentId);
  return ids[(at + 1) % ids.length] ?? null;
}
