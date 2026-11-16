/**
 * Отрисовка правки внутри якоря в DOM docx-preview. Якорь — обычный элемент, не React:
 * содержимое и классы выставляются императивно при каждом изменении решения или режима.
 * Исходное содержимое берётся из `originals`, поэтому любое решение обратимо.
 */
import {
  changeTypeMeta,
  decisionLabel,
  type ChangeType,
  type SuggestionStatus,
} from '@/domain/editor/suggestion';
import { cn } from '@/lib/cn';

export type InlineMode = 'suggestions' | 'clean';

export interface AnchorState {
  changeType: ChangeType;
  status: SuggestionStatus;
  newText: string;
  selected: boolean;
}

const BASE_CLASS =
  'cursor-pointer rounded-sm box-decoration-clone outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring';

const pendingTone: Record<ChangeType, string> = {
  modify: 'bg-amber-50 ring-1 ring-amber-300',
  delete: 'bg-red-50 ring-1 ring-red-200',
  add: 'bg-emerald-50 ring-1 ring-emerald-200',
};

const acceptedTone: Record<ChangeType, string> = {
  modify: 'bg-emerald-50',
  add: 'bg-emerald-50',
  delete: '',
};

const DEL_PENDING = 'line-through decoration-2 text-muted-foreground decoration-amber-600';
const DEL_DELETE = 'line-through decoration-2 text-red-700/80 decoration-red-600';
const INS_PENDING = 'ml-1 font-medium text-foreground no-underline';

export function decorateAnchor(
  element: HTMLElement,
  original: DocumentFragment,
  state: AnchorState,
  mode: InlineMode,
): void {
  const { changeType, status, newText, selected } = state;
  const doc = element.ownerDocument;
  const decided = status !== 'pending';
  const accepted = status === 'accepted';
  const quiet = mode === 'clean' && decided;

  element.replaceChildren();
  element.hidden =
    (changeType === 'add' && status === 'rejected') ||
    (mode === 'clean' && accepted && changeType === 'delete');
  if (element.hidden) return;

  if (status === 'pending') {
    if (changeType !== 'add') {
      const del = doc.createElement('del');
      del.className = changeType === 'delete' ? DEL_DELETE : DEL_PENDING;
      del.appendChild(original.cloneNode(true));
      element.appendChild(del);
    }
    if (changeType !== 'delete') {
      const ins = doc.createElement('ins');
      ins.className =
        changeType === 'add' ? 'font-medium text-foreground no-underline' : INS_PENDING;
      ins.textContent = newText;
      element.appendChild(ins);
    }
  } else if (accepted) {
    if (changeType === 'delete') {
      const del = doc.createElement('del');
      del.className = 'line-through decoration-2 text-red-700/70 decoration-red-400';
      del.appendChild(original.cloneNode(true));
      element.appendChild(del);
    } else {
      const ins = doc.createElement('ins');
      ins.className = 'no-underline';
      ins.textContent = newText;
      element.appendChild(ins);
    }
  } else {
    element.appendChild(original.cloneNode(true));
  }

  const tone = quiet
    ? 'hover:bg-muted/40'
    : status === 'pending'
      ? pendingTone[changeType]
      : accepted
        ? acceptedTone[changeType]
        : 'bg-muted/40';
  element.className = cn(
    BASE_CLASS,
    'px-0.5',
    changeType === 'add' && 'w-fit max-w-full',
    tone,
    selected && 'ring-2 ring-primary ring-offset-1',
  );
  element.setAttribute('role', 'button');
  element.tabIndex = 0;
  element.setAttribute('aria-pressed', String(selected));
  const meta = changeTypeMeta[changeType];
  element.setAttribute(
    'aria-label',
    `${meta.label}${decided ? `, ${decisionLabel[status].toLowerCase()}` : ''}`,
  );
}
