export type CorrectionType = 'grammar' | 'word_choice' | 'collocation' | 'other';

export interface Correction {
  original: string;
  corrected: string;
  reason_zh: string;
  type: CorrectionType;
}

export interface CorrectionResult {
  corrections: Correction[];
  optimized_full_sentence: string;
  reply_text: string;
  reply_translation_zh?: string;
  /** 仅引导开启时返回：一句中文，提示学习者下一句可以说什么（承接 reply_text）。 */
  next_hint_zh?: string;
}

export interface TopicDraft {
  scene_en: string;
  title_en: string;
  title_zh: string;
  prompt_zh: string;
  icebreaker_en: string;
  icebreaker_zh?: string;
  /**
   * Who speaks icebreaker_en first.
   * - 'learner': a hint for the learner's opening line (not sent to the LLM history).
   * - 'assistant' (or missing on old records): the AI's opening message, included in history.
   */
  icebreaker_role?: 'learner' | 'assistant';
  /** 3-5 short English tags used to detect similar topics. */
  tags?: string[];
  /**
   * 2-3 条纯中文方向提示（每条 ≤ 20 字），只在会话开头展示。
   * 缺省表示该话题没有引导内容（老数据 / 内置兜底话题）。
   */
  hints_zh?: string[];
}

/** AI-generated topic waiting in the local queue for a future day. */
export interface QueuedTopic extends TopicDraft {
  queuedAt: number;
}

export interface TopicRecord extends TopicDraft {
  /** Keyed by local date, e.g. 2026-11-12 */
  dateKey: string;
  poolId: string;
  source: 'llm' | 'fallback';
  createdAt: number;
  /**
   * 会话开启时的引导开关快照。老数据缺省，视为关闭。
   * 快照只在进入练习页时写入一次，此后改全局开关不影响本会话。
   */
  hintsEnabled?: boolean;
}

export interface SessionRecord {
  id?: number;
  dateKey: string;
  topicId: string;
  topicTitleEn: string;
  topicTitleZh: string;
  userText: string;
  corrections: Correction[];
  optimizedFullSentence: string;
  replyText: string;
  replyTranslationZh?: string;
  /** 本轮给出的"下一句可以聊"（中文）。历史页不展示。 */
  nextHintZh?: string;
  ttsCacheKey: string;
  voice: string;
  createdAt: number;
}

export interface AudioCacheRecord {
  key: string;
  blob: Blob;
  voice: string;
  text: string;
  createdAt: number;
}

export interface UsageRecord {
  /** LLM 总 token（兼容旧记录与展示） */
  llmTokens: number;
  llmInputTokens: number;
  llmCachedInputTokens: number;
  llmOutputTokens: number;
  asrRequests: number;
  asrSeconds: number;
  ttsChars: number;
  updatedAt: number;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  apiKey: string;
  voice: string;
  theme: ThemeMode;
  autoPlay: boolean;
  /** 全局：新开启的会话是否使用中文思路引导。 */
  hintsEnabled: boolean;
}

export type PracticeStage = 'idle' | 'recording' | 'transcribing' | 'thinking';
