import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  Languages,
  Pause,
  Search,
  Volume2,
  X,
} from 'lucide-react';
import {
  lookupDictionary,
  type DictionaryResult,
  type EnEntry,
  type ZhEntry,
} from '../lib/dictionary';
import { usePronunciation } from '../hooks/usePronunciation';
import { classNames } from '../lib/utils';
import { useToast } from './Toast';
import { Spinner } from './Spinner';

type LookupStatus = 'idle' | 'loading' | 'error';

const QUICK_QUERIES = ['顺便', '洗手间', '听起来', 'convenient', 'restroom'];

/**
 * 练习页右侧的查词入口：
 * 屏幕右缘的竖排小按钮 + 从右侧滑出的本地英汉词典抽屉。
 */
export function DictionaryDrawer() {
  const toast = useToast();
  const { speak, stop, speakingKey, error: pronunciationError } = usePronunciation();

  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<DictionaryResult | null>(null);
  const [status, setStatus] = useState<LookupStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSeqRef = useRef(0);
  const wasOpenRef = useRef(false);

  // 抽屉贴着居中的内容栏右缘；手机上和屏幕右缘重合。
  const edgeOffset = 'max(0px, calc((100vw - 520px) / 2))';

  // 先挂载、下一帧再滑入，关闭时先滑出、动画结束再卸载。
  useEffect(() => {
    if (open) {
      setVisible(true);
      const timer = window.setTimeout(() => setEntered(true), 20);
      return () => window.clearTimeout(timer);
    }
    setEntered(false);
    const timer = window.setTimeout(() => setVisible(false), 300);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 打开时锁定页面滚动、屏蔽背景交互并聚焦输入框；关闭后把焦点还给入口按钮。
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      const root = document.getElementById('root');
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      root?.setAttribute('inert', '');
      const timer = window.setTimeout(() => inputRef.current?.focus(), 260);
      return () => {
        window.clearTimeout(timer);
        document.body.style.overflow = previousOverflow;
        root?.removeAttribute('inert');
      };
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // 关闭抽屉时停止发音，避免声音在页面切换后继续播放。
  useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1;
    };
  }, []);

  const runSearch = useCallback(
    async (raw: string) => {
      const text = raw.trim().replace(/\s+/g, ' ');
      if (!text) return;

      stop();
      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;
      setResult(null);
      setError(null);
      setStatus('loading');

      try {
        const next = await lookupDictionary(text);
        if (seq !== requestSeqRef.current) return;
        setResult(next);
        setStatus('idle');
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : '词库加载失败，请稍后重试。');
        setStatus('error');
      }
    },
    [stop],
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(query);
  };

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    if (status === 'error') {
      setStatus('idle');
      setError(null);
    }
  };

  const handleQuickQuery = (text: string) => {
    setQuery(text);
    void runSearch(text);
  };

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(key);
      toast('已复制释义', 'success');
      window.setTimeout(() => {
        setCopiedText((current) => (current === key ? null : current));
      }, 1600);
    } catch {
      toast('复制失败，请手动选择文本', 'error');
    }
  };

  const hasEntries =
    result !== null && (result.zhEntries.length > 0 || result.enEntries.length > 0);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="打开英汉词典"
        aria-expanded={open}
        aria-controls="dictionary-panel"
        style={{ right: edgeOffset }}
        className="fixed top-1/2 z-30 flex min-w-[36px] -translate-y-1/2 flex-col items-center gap-1.5 rounded-l-2xl border border-r-0 border-line bg-surface px-2 py-3.5 text-brand shadow-float transition active:scale-95"
      >
        <BookOpen className="size-4" />
        <span className="text-[10px] font-semibold leading-none tracking-[0.16em] [writing-mode:vertical-rl]">
          查词
        </span>
      </button>

      {visible &&
        createPortal(
          <>
            <div
              aria-hidden="true"
              onClick={() => setOpen(false)}
              className={classNames(
                'fixed inset-0 z-40 bg-black/35 transition-opacity duration-300',
                entered ? 'opacity-100' : 'opacity-0',
              )}
            />

            <aside
              id="dictionary-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dictionary-title"
              style={{
                right: edgeOffset,
                transform: entered ? 'translateX(0)' : `translateX(calc(100% + ${edgeOffset}))`,
              }}
              className="fixed inset-y-0 z-50 flex w-[86vw] max-w-[380px] flex-col border-l border-line bg-surface shadow-float transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            >
              <header className="flex items-start gap-2.5 border-b border-line px-4 pb-3 pt-safe">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <BookOpen className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id="dictionary-title" className="text-[15px] font-semibold text-ink">
                    英汉词典
                  </h2>
                  <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
                    中英互查，支持本地发音
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭词典面板"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface2 text-muted transition active:scale-95"
                >
                  <X className="size-4" />
                </button>
              </header>

              <form onSubmit={handleSubmit} className="flex gap-2 px-4 pt-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={handleQueryChange}
                  maxLength={80}
                  enterKeyHint="search"
                  aria-label="输入中文或英文"
                  placeholder="输入中文或英文单词/短语"
                  className="min-w-0 flex-1 rounded-2xl border border-line bg-surface2 px-3.5 py-2.5 text-[16px] leading-6 text-ink placeholder:text-[14px] placeholder:text-muted focus:border-brand focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={status === 'loading' || !query.trim()}
                  aria-label="查询"
                  className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-white transition active:bg-brand-strong disabled:opacity-40 dark:text-[#1a1830]"
                >
                  {status === 'loading' ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Search className="size-4" />
                  )}
                </button>
              </form>

              <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-3">
                {status === 'loading' && (
                  <div className="space-y-3">
                    <p className="text-[12px] leading-5 text-muted">正在加载词库…</p>
                    {[0, 1].map((item) => (
                      <div
                        key={item}
                        className="animate-pulse rounded-2xl border border-line bg-surface p-3.5"
                      >
                        <div className="h-5 w-2/3 rounded-full bg-surface2" />
                        <div className="mt-2.5 h-3 w-full rounded-full bg-surface2" />
                        <div className="mt-2 h-3 w-4/5 rounded-full bg-surface2" />
                      </div>
                    ))}
                  </div>
                )}

                {status === 'error' && (
                  <div className="rounded-2xl border border-rose-200/70 bg-rose-50 px-3.5 py-3 dark:border-rose-400/20 dark:bg-rose-400/10">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-500 dark:text-rose-300" />
                      <p className="min-w-0 text-[12.5px] leading-5 text-rose-700 dark:text-rose-200">
                        {error}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void runSearch(query)}
                      className="mt-3 min-h-[36px] rounded-xl bg-surface px-3 text-[12.5px] font-medium text-ink active:opacity-80"
                    >
                      重试
                    </button>
                  </div>
                )}

                {status === 'idle' && !result && (
                  <div className="pt-4">
                    <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-surface2 text-brand">
                      <Languages className="size-5" />
                    </div>
                    <p className="mt-3 text-center text-[13px] font-medium text-ink">
                      输入中文或英文单词/短语
                    </p>
                    <p className="mt-1 text-center text-[12px] leading-5 text-muted">
                      中→英显示英文释义；英→中显示中文释义，并支持本地发音。
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {QUICK_QUERIES.map((text) => (
                        <button
                          key={text}
                          type="button"
                          onClick={() => handleQuickQuery(text)}
                          className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-muted transition active:bg-surface2"
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {status === 'idle' && result && !hasEntries && (
                  <div className="rounded-2xl border border-line bg-surface px-4 py-5 text-center">
                    <BookOpen className="mx-auto size-6 text-muted" />
                    <p className="mt-2 text-[13px] font-medium text-ink">
                      本地词典暂未收录「{result.query}」
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-muted">
                      试试更常见的单词，或换一个说法。
                    </p>
                  </div>
                )}

                {status === 'idle' && result && hasEntries && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-brand-soft px-2 py-1 text-[10px] font-semibold text-brand">
                        {result.direction === 'zh-en' ? '中 → 英' : '英 → 中'}
                      </span>
                      <p className="min-w-0 truncate text-[12px] text-muted" title={result.query}>
                        {result.query}
                      </p>
                    </div>

                    {result.zhEntries.map((entry) => (
                      <ZhResultCard
                        key={`${entry.s}-${entry.d.join('|')}`}
                        entry={entry}
                        speaking={speakingKey === `zh:${entry.s}`}
                        copied={copiedText === `zh:${entry.s}`}
                        onSpeak={() => speak(entry.s, 'zh-CN', `zh:${entry.s}`)}
                        onCopy={() => void handleCopy(entry.d.join('; '), `zh:${entry.s}`)}
                      />
                    ))}

                    {result.enEntries.map((entry) => (
                      <EnResultCard
                        key={`${entry.w}-${entry.z.join('|')}`}
                        entry={entry}
                        speaking={speakingKey === `en:${entry.w}`}
                        copied={copiedText === `en:${entry.w}`}
                        onSpeak={() => speak(entry.w, 'en-US', `en:${entry.w}`)}
                        onCopy={() => void handleCopy(entry.z.join('；'), `en:${entry.w}`)}
                      />
                    ))}

                    {pronunciationError && (
                      <p className="flex items-start gap-1.5 text-[11.5px] leading-5 text-amber-600 dark:text-amber-300">
                        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                        <span className="min-w-0">{pronunciationError}</span>
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-5 border-t border-line pt-3 text-[10.5px] leading-5 text-muted">
                  词条数据：
                  <a
                    href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-line underline-offset-2"
                  >
                    CC-CEDICT
                  </a>
                  （CC BY-SA 4.0）、
                  <a
                    href="https://freedict.org/dictionaries/eng-zho/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-line underline-offset-2"
                  >
                    FreeDict eng-zho
                  </a>
                  （CC BY-SA 3.0）。发音由浏览器语音合成提供。
                </div>
              </div>
            </aside>
          </>,
          document.body,
        )}
    </>
  );
}

interface ResultCardProps {
  speaking: boolean;
  copied: boolean;
  onSpeak: () => void;
  onCopy: () => void;
}

function ResultActions({ speaking, copied, onSpeak, onCopy }: ResultCardProps) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onSpeak}
        aria-label={speaking ? '停止发音' : '播放发音'}
        className={classNames(
          'flex size-8 items-center justify-center rounded-full transition active:scale-95',
          speaking
            ? 'bg-brand text-white dark:text-[#1a1830]'
            : 'bg-surface2 text-brand active:bg-brand-soft',
        )}
      >
        {speaking ? <Pause className="size-3.5" /> : <Volume2 className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={onCopy}
        aria-label="复制释义"
        className={classNames(
          'flex size-8 items-center justify-center rounded-full transition active:scale-95',
          copied
            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300'
            : 'bg-surface2 text-muted active:text-brand',
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function ZhResultCard({
  entry,
  speaking,
  copied,
  onSpeak,
  onCopy,
}: {
  entry: ZhEntry;
} & ResultCardProps) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-3.5 animate-fade-up">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="font-serif text-[19px] leading-7 text-ink">{entry.s}</p>
            {entry.t && entry.t !== entry.s && (
              <span className="text-[12px] text-muted">{entry.t}</span>
            )}
          </div>
          <ul className="mt-2 space-y-1.5">
            {entry.d.map((definition, index) => (
              <li
                key={`${entry.s}-${index}`}
                className="flex gap-2 text-[13.5px] leading-6 text-ink"
              >
                <span className="mt-[9px] size-1 shrink-0 rounded-full bg-brand/60" />
                <span className="min-w-0">{definition}</span>
              </li>
            ))}
          </ul>
        </div>
        <ResultActions speaking={speaking} copied={copied} onSpeak={onSpeak} onCopy={onCopy} />
      </div>
    </article>
  );
}

function EnResultCard({
  entry,
  speaking,
  copied,
  onSpeak,
  onCopy,
}: {
  entry: EnEntry;
} & ResultCardProps) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-3.5 animate-fade-up">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="font-serif text-[19px] leading-7 text-ink">{entry.w}</p>
            {entry.p && (
              <span className="rounded-full bg-surface2 px-1.5 py-0.5 text-[10.5px] text-muted">
                {entry.p}
              </span>
            )}
          </div>
          {entry.r?.length ? (
            <p className="mt-1 text-[12.5px] leading-5 text-muted">
              {entry.r.map((pronunciation) => `/${pronunciation}/`).join(' · ')}
            </p>
          ) : null}
          <p className="mt-2 text-[14px] leading-6 text-ink">{entry.z.join('；')}</p>
        </div>
        <ResultActions speaking={speaking} copied={copied} onSpeak={onSpeak} onCopy={onCopy} />
      </div>
    </article>
  );
}
