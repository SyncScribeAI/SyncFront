import { useId } from 'react';

export const FULL_ANALYSIS_LABEL = 'Полный повторный анализ';
export const FULL_ANALYSIS_HINT =
  'Весь документ проверяется заново, текущие правки и решения заменяются новым результатом.';

interface FullAnalysisSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * Переключатель стратегии full. Нативный checkbox с ролью switch: клавиатура и чтение
 * экрана работают без отдельной библиотеки, а набор зависимостей остаётся прежним.
 */
export function FullAnalysisSwitch({
  checked,
  onCheckedChange,
  disabled,
}: FullAnalysisSwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-describedby={`${id}-hint`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="peer relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-slate-300 transition-colors before:absolute before:left-0.5 before:top-0.5 before:size-4 before:rounded-full before:bg-background before:shadow before:transition-transform checked:bg-primary checked:before:translate-x-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="space-y-0.5">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium">
          {FULL_ANALYSIS_LABEL}
        </label>
        <span id={`${id}-hint`} className="block text-xs text-muted-foreground">
          {FULL_ANALYSIS_HINT}
        </span>
      </span>
    </div>
  );
}
