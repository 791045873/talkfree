import { useState } from 'react';
import { ChevronDown, Lightbulb } from 'lucide-react';
import { classNames } from '../lib/utils';

interface HintPanelProps {
  /** 纯中文方向提示，最多 3 条。 */
  hints: string[];
}

/**
 * 会话开头的方向卡：收起时只占一行，点开才铺开。
 * 不判对错、不要求逐条完成——它只是"不知道说什么"时的弹药。
 */
export function HintPanel({ hints }: HintPanelProps) {
  const [open, setOpen] = useState(false);

  if (hints.length === 0) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2 px-3.5 py-2 text-left transition active:bg-surface2"
      >
        <Lightbulb className="size-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">
          {hints.length} 个思路
        </span>
        <ChevronDown
          className={classNames(
            'size-4 shrink-0 text-muted transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <ul className="animate-fade-up space-y-1.5 border-t border-line px-3.5 py-3">
          {hints.map((hint) => (
            <li key={hint} className="flex gap-2 text-[13px] leading-6 text-muted">
              <span className="mt-[9px] size-1 shrink-0 rounded-full bg-brand/50" />
              <span className="min-w-0">{hint}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
