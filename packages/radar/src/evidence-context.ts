import { z } from "zod";
export const contextReviewSchema = z.object({
  reviews: z
    .array(
      z.object({
        findingIndex: z.number().int().min(0),
        role: z.enum(["direct_user", "seller", "secondhand", "unknown"]),
        status: z.enum(["unresolved", "resolved", "unknown"]),
        tool: z.string(),
        task: z.string(),
        painLine: z.number().int().min(0).nullable(),
        unresolvedLine: z.number().int().min(0).nullable(),
        reason: z.string().min(1),
        originalLanguage: z.string().max(50).default("unknown"),
        userMarket: z
          .object({
            name: z.string().max(100),
            line: z.number().int().min(0).nullable(),
          })
          .default({ name: "", line: null }),
      }),
    )
    .max(8),
});
export function contextBlocker(
  review: {
    role: string;
    status: string;
    tool: string;
    task: string;
    painQuote: string;
    unresolvedQuote: string;
    reason: string;
  },
  body: string,
) {
  if (review.role !== "direct_user")
    return "缺少直接使用者证据：" + review.reason;
  if (review.status !== "unresolved")
    return "未确认当前仍未解决：" + review.reason;
  if (!review.tool.trim() || !review.task.trim())
    return "缺少具体工具或实际工作任务";
  for (const quote of [review.painQuote, review.unresolvedQuote])
    if (!quote.trim() || !body.includes(quote))
      return "痛点或未解决状态缺少可核对的原文";
  return null;
}
