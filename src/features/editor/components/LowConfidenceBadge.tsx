import { TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { isLowConfidence } from '@/domain/editor/suggestion';

import { EDITOR_TEXTS } from '../model/texts';

/** Причину не показываем отдельно: модель уже объясняет её в rationale. */
export function LowConfidenceBadge({ score }: { score: number | null | undefined }) {
  if (!isLowConfidence(score)) return null;
  return (
    <Badge className="bg-amber-50 text-amber-800 ring-amber-200">
      <TriangleAlert className="size-3" aria-hidden />
      {EDITOR_TEXTS.lowConfidence}
    </Badge>
  );
}
