# 场景对话引导 · 实现方案（已落地）

> 状态：已按本方案实现，`npm run typecheck` / `npm run build` 通过。

## 1. 目标

初学者卡在"不知道说什么"，练习停摆在开口之前，纠错管线根本没机会工作。

在现有"话题角色扮演 + 纠错"之上加一层**纯中文**引导，把"想内容"的成本降到接近零，让注意力落在"怎么用英语说"。

硬约束：

- 引导**只能是中文**。不出现英文示范句、英文关键词、句式模板。
- 引导不是题目：不判对错、不要求逐条完成、不评分。纠错仍是唯一评价者。
- 不为"未来扩展"提前抽象，只留一层薄配置。

## 2. 终态交互

| 出口 | 管什么 | 位置 |
| --- | --- | --- |
| **开场方向** | 这个话题能往哪些方向聊 | 练习页顶部折叠面板，默认收起 |
| **每轮提示** | 下一句可以怎么接 | AI 回复卡片正下方一行灰字 |

一屏最多只有一行灰字：每轮提示在设计上已经把"要不要补信息"合并进去（见 4.2），不需要第二行。

## 3. 关键决策与理由

| 决策 | 理由 |
| --- | --- |
| 每轮提示与 `reply_text` **同一次调用生成** | 提示必须承接 AI 刚说的那句。拆成并行请求时模型看不到那句话，只能猜——这是"生硬转折"的根因 |
| 每轮只给**一句**，且强制承接 `reply_text` | 若 `reply_text` 以问句结尾，提示只指向"怎么回答它"；否则指向"怎么接住它"。不复述问题、不引入新方向、不把已知信息当新信息 |
| 缺信息不单列字段 | 用户这句话信息不足时，把缺的那块**折进同一句提示**，而不是另起一条"补充建议"——两条并排必然有一条显得突兀 |
| 开场提示随话题一起生成 | 零额外请求、零额外延迟，可缓存到 `TopicRecord` |
| 老数据不迁移 | 缺 `hints_zh` 就不显示，不触发补生成 |
| 开关快照到话题上 | "只影响新开启的会话"需要落库，否则刷新就丢 |

## 4. 实现

### 4.1 数据模型

`src/types.ts`：

```ts
TopicDraft.hints_zh?: string[]        // 2~3 条纯中文方向
TopicRecord.hintsEnabled?: boolean    // 会话开启时的开关快照，缺省视为关闭
CorrectionResult.next_hint_zh?: string
SessionRecord.nextHintZh?: string     // 历史页不展示
Settings.hintsEnabled: boolean        // 全局默认，true
```

- **不新增表、不升 Dexie 版本**：都是非索引可选字段。
- `src/lib/settings.ts`：`DEFAULT_SETTINGS.hintsEnabled = true`，`loadSettings` 做布尔兜底。

### 4.2 Prompt

`src/lib/schemas.ts`：

- `CORRECTION_JSON_SCHEMA` 增加 `next_hint_zh`。
- `GUIDANCE_ON_PROMPT`：每轮提示的生成规则（20 字以内、纯中文、承接 `reply_text`、不复述、不引入新方向、缺信息时折进同一句、不重复开场/历史提示、语气对齐场景、不参与 TTS）。
- `GUIDANCE_OFF_PROMPT`：`next_hint_zh` 恒为空字符串。
- `buildCorrectionSystemPrompt(topic, { guidanceEnabled, openingHints })`：把开场提示也塞进去，避免重复推荐。
- `buildCorrectionUserPrompt({ utterance, previousHints })`：带上最近 8 条已给过的提示。
- 两个话题 prompt（批量 / 自定义）都产出 `hints_zh`，并写明四条规定：第二人称口语、只给信息维度不给整句、只用话题已有事实、零英文零教学口吻。
- `CORRECTION_SYSTEM_PROMPT` 里"never write lines the learner should say"补了例外说明，否则模型会拒绝写 `next_hint_zh`。

`src/lib/api.ts`：

- `HISTORY_MESSAGE_LIMIT`：16 → 40，让提示贴得住上下文（token 成本可忽略）。
- `normalizeHints` / `normalizeRoundHint`：直接丢弃夹带英文、超长的结果。**硬约束由清洗兜底，不靠模型自觉。**
- 自定义话题 `max_completion_tokens`：700 → 900，给 `hints_zh` 留余量。

### 4.3 开关与快照

- 设置页新增「场景对话引导」（`role="switch"`，与「自动播放」同款）。
- 快照**只在 `usePractice.sync()` 写一处**：拿到当天话题后若 `hintsEnabled === undefined`，用当前全局值补齐并回写 `topics`。四条造话题路径（自动 / 换一个 / 自定义 / 队列出池）全部覆盖，快照时刻 = 用户真正进入会话的时刻。
- `usePractice` 发请求时用 `topic.hintsEnabled !== false`，所以中途改全局开关不影响已打开的话题。

### 4.4 UI

| 文件 | 改动 |
| --- | --- |
| `src/components/HintPanel.tsx`（新） | 收起时一行「N 个思路」，点开铺开；`key` 绑定 `dateKey:title_en`，换话题自动复位 |
| `src/pages/PracticePage.tsx` | 在 sticky 话题卡下方渲染，条件 `hintsEnabled !== false && hints_zh?.length` |
| `src/components/PracticeChat.tsx` | AI 回复卡下方一行灰字（灯泡图标 + `nextHintZh`），视觉上属于"给你的提示"而非 AI 台词 |
| `src/pages/SettingsPage.tsx` | 新增开关 Section |
| `src/pages/HistoryPage.tsx` | 不动，`nextHintZh` 不展示 |

## 5. 降级矩阵

| 情况 | 表现 |
| --- | --- |
| 话题没有 `hints_zh`（老数据 / 内置兜底话题） | 不渲染面板 |
| 升级前已入队的旧话题（无 `hints_zh`） | 消费队列时丢弃，按需重新生成一批带提示的话题；预填阈值只统计带提示的条目 |
| LLM 返回的提示夹带英文 / 超长 | 清洗丢弃，该轮不显示 |
| 全局开关关闭 | 新会话既无面板也无每轮提示 |
| 纠错请求失败 | 走现有错误提示，与引导无关 |
| 快照落库失败 | 内存里仍生效，不影响本次练习 |

## 6. 成本

| 项 | 增量 |
| --- | --- |
| 话题生成 | 每题 +~150 output token |
| 每轮 | +~100 output token、历史放宽到 40 条（+1~2k input token） |
| 请求数 | **+0**（提示折进纠错调用） |
| 延迟 | +0 |

## 7. 明确不做

- 不做翻译题、不判对错、不做覆盖率评分。
- 不做脚手架自动撤退（按轮次 / 熟练度）。
- 不做提示使用埋点，因此**本版本无法回答"提示是否让人说得更长"**——这是已知盲区。
- 不做历史话题的"继续练习"入口（数据里已带快照，留给未来）。
- 不给内置池子手写提示。

## 8. 验收

1. 新话题进入练习页顶部出现收起状态的「N 个思路」，点开是纯中文、无英文。
2. 提示只用话题已给定的事实，没有凭空新增时间/地点/人物。
3. 每轮 AI 回复下方有一行中文，内容是回答 AI 刚问的那句，不换话题。
4. 说一句很干的话（如 "I want to change it."），这一行里会顺带补上缺的信息，而不是另起一行。
5. 关掉全局开关后，新话题完全没有引导区；当前已开会话不受影响；重新打开后新话题恢复。
6. 面板展开状态刷新即复位。
7. 老话题（无 `hints_zh`）不显示引导、不触发补生成。
8. 排队池出池的话题自带提示。
9. 历史页看不到这两类提示。
10. `npm run typecheck`、`npm run build` 通过。
