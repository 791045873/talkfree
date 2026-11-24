# 英汉互译本地词典 · 开发计划（已落地）

> 状态：已按本方案实现。`npm run typecheck` / `npm run build` 通过。
>
> 目标版本：V1。只做本地词库，不接免费 API，不保留 LLM 查词。

## 1. 目标

在练习页右侧抽屉里提供一个完全本地的英汉互译词典：

- 输入中文单词/词组 → 显示英文释义
- 输入英文单词/词组 → 显示中文释义
- 保留英文 IPA 音标；不显示拼音
- 支持点击发音（浏览器本地语音合成，不调用 MiMo TTS）
- 不调用 MiMo LLM，不调用任何在线翻译/词典 API
- 词库数据可替换，后续升级不影响 UI

硬约束：

- 查词不依赖 API Key，不产生 token 费用。
- 除加载静态词典分片外，查词不发网络请求。
- 发音只使用浏览器 `SpeechSynthesis`，不消耗 TTS 字符数。
- 数据加载必须分片，不能把整部词典塞进 JS bundle 或首屏。
- 不做整句翻译；只做词条查询。必要时明确提示“本地词典未收录”。

## 2. 词库选型

V1 使用两本原生词典组合，而不是一个单向词库做双向索引：

| 方向 | 数据源 | 规模 | 体积 | 许可证 |
| --- | --- | --- | --- | --- |
| 中 → 英 | CC-CEDICT | 约 125,060 条 | 原始 9.5 MB，gzip 约 4 MB | CC BY-SA 4.0 |
| 英 → 中 | FreeDict `eng-zho` | 26,660 个英文词头 | StarDict 包 1.67 MB，解包约 8.1 MB | CC BY-SA 3.0 |

说明：

- CC-CEDICT 的 `↔` 只是词典描述；其数据模型是“中文词头 + 英文释义”，没有英文词头索引。中→英直接使用，英→中不作为主路径。
- 不选 ECDICT 作为 V1 的唯一词库：它原生是英→中，且 CSV 约 66 MB；中→英需要反向索引，体积和接入成本都更高。ECDICT 留给英→中升级。
- 不选 WikDict 作为主词库：实测常见中文词（顺便、洗手间、没问题）覆盖不足。
- 不选 PanLex：体积大，许可证存在 CC0/CC BY-NC-SA 的表述冲突，不适合当前项目。

## 3. 数据构建

### 3.1 源数据固定

构建脚本固定以下输入，不跟随最新版漂移：

```text
CC-CEDICT:
https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz

FreeDict eng-zho:
https://download.freedict.org/dictionaries/eng-zho/2025.11.23/
  freedict-eng-zho-2025.11.23.stardict.tar.xz
```

构建时在 `manifest.json` 记录：

- 数据源名称、URL
- 版本/日期
- 词条数
- 许可证
- 构建时间

### 3.2 输出目录

```text
public/dict/
├─ manifest.json
├─ NOTICE.txt
├─ zh/
│  ├─ u00.json
│  ├─ u01.json
│  └─ ...             # 256 个分片
└─ en/
   ├─ ab.json
   ├─ co.json
   └─ ...             # 按英文前两个字符分片
```

`public/dict` 由构建脚本生成，建议提交到仓库，保证 Vercel 构建不依赖外部下载；`npm run build:dict` 用于手动刷新。

### 3.3 数据格式

中→英分片：

```json
{
  "谢谢": { "s": "谢谢", "t": "謝謝", "d": ["to thank", "thanks"] },
  "順便": { "s": "顺便", "t": "順便", "d": ["conveniently", "in passing"] }
}
```

英→中分片：

```json
{
  "convenient": [
    {
      "w": "convenient",
      "z": ["方便", "便利"],
      "p": "adj.",
      "r": ["kənˈvinjənt", "kənˈviːniənt"]
    }
  ],
  "thank you": [
    {
      "w": "thank you",
      "z": ["谢谢"],
      "p": "interj.",
      "r": ["ˈðæŋk ˌju", "ˈθæŋk ˌju"]
    }
  ]
}
```

约定：

- 中文分片不写 `pinyin`。中文发音靠 `SpeechSynthesis`，界面不显示拼音。
- 英文分片保留 FreeDict 的 IPA，字段为 `r`，最多保留 3 个；UI 展示时加 `/.../`。
- 中文同时收录简体和繁体 key；英文 key 统一小写归一化。
- 同一词条多义时合并 `d` / `z` 数组，去重后保留顺序。
- 英文词头保留空格、连字符和撇号，用于短语查询。

### 3.4 分片规则

- 中文：首个汉字的 Unicode 码点 `% 256` → `zh/uXX.json`。
- 英文：归一化后前两个字母/数字 → `en/xx.json`；不足两个字符或无法归一化 → `en/__.json`。
- 如果某个英文分片超过约 300 KB 原始大小，再按前三个字符拆分，避免单次加载过大。
- 每个分片按 key 排序，保证构建产物稳定可 diff。

体积预估：

- 中→英分片：256 个，平均约 60~80 KB 原始，单个 gzip 后约 15~25 KB。
- 英→中分片：26,660 词条，单个 gzip 后通常小于 30 KB。
- 首次查询只加载命中的一个分片，不加载整部词典。

### 3.5 构建脚本

新增 `scripts/build_dictionary.py`，参考 `tangkk/bilingual-dictionary` 的 MIT 构建脚本，做以下调整：

- 去掉 CC-CEDICT 的拼音输出。
- 保留 FreeDict 的 IPA 音标，最多 3 个。
- V1 不生成 Tatoeba 例句索引，也不引入 jieba 词性。
- 不生成 CC-CEDICT 反向索引；英→中只用 FreeDict 原生词条。
- 输出 `manifest.json`、`NOTICE.txt` 和分片 JSON。
- 构建脚本只使用 Python 标准库，避免引入新依赖。
- `package.json` 增加：

```json
"build:dict": "python3 scripts/build_dictionary.py"
```

> 日常开发不需要运行该脚本；分片数据已提交在 `public/dict`。只有刷新词库时才需要 Python 3.10+。

## 4. 运行时实现

### 4.1 新增 `src/lib/dictionary.ts`

职责：

- 定义本地词典类型。
- 判断查询方向。
- 归一化输入、计算分片 key。
- 加载并缓存分片。
- 返回统一的查询结果。

类型建议：

```ts
export interface ZhEntry {
  s: string;
  t?: string;
  d: string[];
}

export interface EnEntry {
  w: string;
  z: string[];
  p?: string;
  r?: string[];
}

export type DictionaryDirection = 'zh-en' | 'en-zh';

export interface DictionaryResult {
  direction: DictionaryDirection;
  query: string;
  zhEntries: ZhEntry[];
  enEntries: EnEntry[];
}
```

核心函数：

```ts
export function detectDirection(input: string): DictionaryDirection;
export function loadShard(direction: DictionaryDirection, key: string): Promise<Shard>;
export function lookupDictionary(input: string): Promise<DictionaryResult>;
```

规则：

- 输入包含 CJK 字符 → `zh-en`；否则 → `en-zh`。
- 中文输入保留原始字符；英文输入 `trim().toLowerCase()`，压缩连续空格，去掉首尾标点。
- 中文精确匹配；命中简体或繁体 key 都返回同一条目，UI 去重。
- 英文精确匹配；V1 不做词形还原（`apples` 查不到 `apple` 时直接提示未收录）。
- 分片缓存：
  - 模块级 `Map<string, Promise<Shard>>`，同一个分片只请求一次。
  - 依赖浏览器 HTTP 缓存；V1 不新增 Dexie 表，不改变数据库版本。
- 分片加载失败时抛出可读错误，由 UI 展示重试。

### 4.2 重写 `src/components/DictionaryDrawer.tsx`

保留现有交互骨架：

- 右侧竖排「查词」按钮
- 右侧滑出抽屉
- 遮罩、Esc、焦点管理、滚动锁定、Portal
- 快捷查询 chips

替换数据与结果区：

| 区域 | V1 内容 |
| --- | --- |
| 搜索框 | 占位符改为「输入中文或英文单词/短语」 |
| 加载态 | 「正在加载词库…」+ 骨架，不再显示 LLM 查询文案 |
| 中→英结果 | 中文词、繁体（如有）、英文释义列表、中文发音按钮 |
| 英→中结果 | 英文词、IPA 音标、词性（如有）、中文释义列表、英文发音按钮 |
| 空结果 | 「本地词典暂未收录这个词」+ 换一个词的建议 |
| 错误 | 分片加载失败提示 + 重试按钮 |
| 底部 | 数据来源与许可证说明入口 |

快捷 chips 改为中英混合，例如：

```text
顺便 / 洗手间 / 听起来 / convenient / restroom
```

删除：

- `useSettings` 的 API Key 判断
- 「去设置」入口
- LLM 请求状态和 `errorMessage`
- 旧的复制逻辑可保留，但只复制主要译文

### 4.3 发音

新增 `src/hooks/usePronunciation.ts`，只依赖浏览器 `SpeechSynthesis`：

```ts
const { speak, stop, speakingKey, error } = usePronunciation();

speak('convenient', 'en-US', 'en-convenient');
speak('谢谢', 'zh-CN', 'zh-谢谢');
```

行为：

- 点击英文词条的音标/喇叭 → 用 `en-US` 朗读英文词头。
- 点击中文词条的喇叭 → 用 `zh-CN` 朗读中文词条。
- 使用 `speakingKey` 标记当前正在朗读的条目；再次点击同一条目则停止。
- 切换查询、关闭抽屉、组件卸载时调用 `speechSynthesis.cancel()`。
- 优先选择 `lang` 匹配的系统语音；没有匹配语音时退回浏览器默认语音。
- 不支持的浏览器或没有可用语音时，在结果区显示一行轻提示，不阻塞查词。
- 发音不请求 MiMo TTS，不计入 token/字符费用。

注意：

- 发音质量取决于操作系统和浏览器自带的语音包，不同设备会不一致。
- iOS/Safari 需要在点击事件中同步调用 `speak()`，因此按钮直接触发，不做异步等待。
- V1 不内置 mp3 音频文件，避免引入额外的音频体积和授权问题。

### 4.4 删除 LLM 查词代码

| 文件 | 改动 |
| --- | --- |
| `src/lib/api.ts` | 删除 `lookupDictionary`、`DictionaryLookupRequest`、`normalizeDictionaryEntries` 及 `DICTIONARY_SYSTEM_PROMPT` 导入 |
| `src/lib/schemas.ts` | 删除 `DICTIONARY_JSON_SCHEMA`、`DICTIONARY_SYSTEM_PROMPT` |
| `src/types.ts` | 删除旧的 `DictionaryEntry` / `DictionaryResult`，类型迁移到 `src/lib/dictionary.ts` |
| `src/components/DictionaryDrawer.tsx` | 改用本地词典模块 |
| `src/components/Toast.tsx` | 保留当前的 `z-[60]`，避免被抽屉遮挡 |
| `README.md` | 重写「中文查词」章节，改为本地词库说明 |

## 5. 查询与降级矩阵

| 情况 | 行为 |
| --- | --- |
| 中文精确命中简体 | 显示英文释义 |
| 中文精确命中繁体 | 返回同一条目，UI 去重 |
| 英文精确命中 | 显示中文释义和词性 |
| 英文大小写不同 | 归一化后命中 |
| 输入前后有标点/空格 | 清理后查询 |
| 中英混合 | 含 CJK 按中文查，否则按英文查 |
| 未收录 | 空状态，提示换词；不做模糊匹配 |
| 分片 404/网络失败 | 错误提示 + 重试 |
| 连续快速查询 | 只渲染最后一次查询结果，旧结果丢弃 |
| 无 API Key | 不影响查词 |
| 离线且分片已缓存 | 浏览器缓存命中时可查；未缓存则报错 |

## 6. 许可证与归属

V1 数据均为 CC BY-SA：

- CC-CEDICT：CC BY-SA 4.0
- FreeDict `eng-zho`：CC BY-SA 3.0

落地要求：

- `public/dict/NOTICE.txt` 写明来源、版本、许可证和链接。
- 抽屉底部增加「数据来源」折叠说明，至少包含：
  - CC-CEDICT / MDBG
  - FreeDict / WikDict / Wiktionary
- `manifest.json` 保留 attribution 字段，方便后续做 About 页。
- 如果未来不能接受 ShareAlike，需要换词库，而不是删除声明。

## 7. 验收清单

1. 输入「谢谢」显示英文释义；输入「謝謝」也能命中。
2. 输入「顺便」显示 `conveniently / in passing` 等释义。
3. 输入 `convenient` 显示中文释义；输入 `Convenient` 同样命中。
4. 输入 `thank you` 这类短语能命中。
5. 输入未收录词显示空状态，不报错、不白屏。
6. 查询过程中 Network 面板只出现 `/dict/**.json`，不出现 `/chat/completions`。
7. 英文词条显示 IPA 音标；界面不显示拼音。
8. 点击英文词条的喇叭能听到英文发音；点击中文词条能听到中文发音；再次点击可停止。
9. 发音不产生 MiMo TTS 请求。
10. 无 API Key 时查词和发音仍可用。
11. 首次查询只加载一个分片；重复查询同一分片不再发请求。
12. 抽屉的遮罩、Esc、焦点恢复、滚动锁定行为与当前一致。
13. 数据来源和许可证在界面可见。
14. `npm run typecheck`、`npm run build` 通过。

## 8. 里程碑

| 阶段 | 工作 | 产出 | 预估 |
| --- | --- | --- | --- |
| 1 | 数据构建脚本 + 生成分片 + manifest/NOTICE | `public/dict/**` | 0.5~1 天 |
| 2 | 本地词典模块与缓存 | `src/lib/dictionary.ts` | 0.5 天 |
| 3 | 重写查词抽屉 | `DictionaryDrawer.tsx` | 0.5 天 |
| 4 | 本地发音 | `usePronunciation.ts` | 0.25 天 |
| 5 | 删除 LLM 查词、更新 README | 清理与文档 | 0.25 天 |
| 6 | 类型检查、构建、手工验收 | 验收记录 | 0.25 天 |

总计约 **2.25 个工作日**。

## 9. 明确不做

- 不做整句翻译、不做 LLM 兜底、不接免费翻译 API。
- 不做拼音。
- V1 不内置真人音频，只用浏览器语音合成。
- V1 不做例句（后续可加 Tatoeba 分片）。
- 不做英文词形还原、拼写纠错、模糊搜索。
- 不做全量词典全文搜索；只查当前分片。
- 不做用户收藏、历史、生词本。
- 不引入 ECDICT；留给英→中升级。

## 10. 后续升级路径

- **英→中质量不够**：把 FreeDict 分片替换成 ECDICT 预处理分片，`en-zh` 接口不变。
- **需要更多英文覆盖**：在构建时加入 CC-CEDICT 反向索引，作为 FreeDict 的补充结果。
- **需要例句**：增加 Tatoeba 中英句对分片，按词条关联。
- **需要离线保证**：把分片缓存到 Cache API 或 Dexie，配 Service Worker。
- **需要中文短语整句**：再评估本地翻译模型或免费 API，但不进入 V1 词典主路径。

## 11. 实施结果

已生成并接入：

- 中文字典分片：256 个，原始约 18.31 MB，gzip 约 5.45 MB，来自 CC-CEDICT，198,067 个简繁 key。
- 英文字典分片：377 个，原始约 2.21 MB，gzip 约 0.70 MB，来自 FreeDict，24,670 个英文 key。
- `public/dict/manifest.json`、`NOTICE.txt` 已生成，记录来源、许可证、词条数。
- `src/lib/dictionary.ts`：方向判断、归一化、分片加载、模块内缓存。
- `src/hooks/usePronunciation.ts`：浏览器 `SpeechSynthesis` 发音，支持中英文。
- `src/components/DictionaryDrawer.tsx`：本地查询结果、IPA 音标、发音、复制、错误/空状态。
- 已删除 `src/lib/api.ts` / `src/lib/schemas.ts` / `src/types.ts` 中的 LLM 查词代码。
- `npm run build:dict` 可重新生成词典数据；`.cache/` 已加入 `.gitignore`。
