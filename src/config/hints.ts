/**
 * 中文思路引导的配置。
 *
 * 目前只放真正会变的旋钮。以后若要扩展引导形态（按语气分层、按熟练度分层等），
 * 先在这里加维度，再让 prompt 读参数，不要在 schemas.ts 里复制出第二套 prompt。
 *
 * 硬约束（不是配置项）：引导内容只能是中文，永远不出现英文示范句、英文关键词或句式模板。
 */
export const HINTS_CONFIG = {
  /** 话题开场时最多给几条方向。 */
  openingCount: 3,
  /** 开场提示的单条字数上限。 */
  openingMaxChars: 20,
  /** 每轮提示的单条字数上限。 */
  roundMaxChars: 20,
  /** 每轮是否给"下一句可以聊"。 */
  perRound: true,
} as const;
