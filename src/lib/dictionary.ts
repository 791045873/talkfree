/** 本地英汉词典：分片加载、方向判断与查询。 */

export interface ZhEntry {
  /** 简体词头。 */
  s: string;
  /** 繁体词头，仅在和简体不同时存在。 */
  t?: string;
  /** 英文释义。 */
  d: string[];
}

export interface EnEntry {
  /** 英文词头。 */
  w: string;
  /** 中文释义。 */
  z: string[];
  /** 词性缩写。 */
  p?: string;
  /** IPA 音标，最多 3 个。 */
  r?: string[];
}

export type DictionaryDirection = 'zh-en' | 'en-zh';

export interface DictionaryResult {
  direction: DictionaryDirection;
  query: string;
  zhEntries: ZhEntry[];
  enEntries: EnEntry[];
}

type Shard<T> = Record<string, T[]>;

// 词库更新后修改这个值，避免浏览器继续使用旧的静态分片缓存。
const DICT_VERSION = '2026-11-24';

const base = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
const DICT_BASE = `${base}dict`;

const shardCache = new Map<string, Promise<unknown>>();
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

async function loadShard<T>(path: string): Promise<T> {
  const cached = shardCache.get(path);
  if (cached) return cached as Promise<T>;

  const request = fetch(`${DICT_BASE}/${path}?v=${DICT_VERSION}`).then(async (response) => {
    if (!response.ok) {
      throw new Error(`词库分片加载失败（${response.status}），请稍后重试。`);
    }
    return (await response.json()) as T;
  });

  shardCache.set(path, request);
  try {
    return await request;
  } catch (error) {
    shardCache.delete(path);
    throw error;
  }
}

/** 英文查询归一化，必须和构建脚本的 normalize_english 保持一致。 */
function normalizeEnglish(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^-+|-+$/g, '');
}

function firstCjkChar(value: string): string {
  return CJK_RE.exec(value)?.[0] ?? '';
}

function zhShardKey(term: string): string {
  const char = firstCjkChar(term) || term[0] || '';
  const code = char.codePointAt(0) ?? 0;
  return `u${(code % 256).toString(16).padStart(2, '0')}`;
}

function enShardKey(term: string): string {
  const safe = term.replace(/[^a-z0-9]/g, '');
  return (safe + '__').slice(0, 2);
}

export function detectDirection(value: string): DictionaryDirection {
  return CJK_RE.test(value) ? 'zh-en' : 'en-zh';
}

export async function lookupDictionary(raw: string): Promise<DictionaryResult> {
  const query = raw.trim().replace(/\s+/g, ' ');

  if (detectDirection(query) === 'zh-en') {
    const char = firstCjkChar(query) || query[0] || '';
    const shard = await loadShard<Shard<ZhEntry>>(`zh/${zhShardKey(char)}.json`);
    return {
      direction: 'zh-en',
      query,
      zhEntries: shard[query] ?? [],
      enEntries: [],
    };
  }

  const normalized = normalizeEnglish(query);
  if (!normalized) {
    return { direction: 'en-zh', query, zhEntries: [], enEntries: [] };
  }
  const shard = await loadShard<Shard<EnEntry>>(`en/${enShardKey(normalized)}.json`);
  return {
    direction: 'en-zh',
    query,
    zhEntries: [],
    enEntries: shard[normalized] ?? [],
  };
}
