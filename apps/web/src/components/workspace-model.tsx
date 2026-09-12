export type Dossier = Record<string, any> & {
  validation: Record<string, string>;
};
export type Claim = {
  id: string;
  product_id: string;
  raw_document_id: string;
  kind: string;
  statement: string;
  quote: string;
  review_status: string;
  url?: string;
};
export type Opportunity = {
  id: string;
  product_id: string;
  title: string;
  status: string;
  dossier: Dossier;
  readiness: { ready: boolean; missing: string[] };
  claims: Claim[];
  decisions?: any[];
  founder_snapshot?: Record<string, string>;
};
export const fields = [
  ["customer", "目标用户", "谁在什么场景下遇到这个问题？"],
  ["buyer", "付费人群", "谁有预算、谁做购买决定？"],
  ["job", "待完成的任务", "用户实际想达成什么结果？"],
  [
    "currentSolution",
    "现有产品已经解决什么",
    "说明现有方案已经覆盖的任务与价值",
  ],
  [
    "unmetNeed",
    "仍未解决的痛点",
    "哪些真实用户反馈表明问题仍然存在？没有证据时保持未知",
  ],
  [
    "whyUnsolved",
    "为什么尚未解决",
    "是产品取舍、细分人群、工作流还是其他约束？标明推断",
  ],
  [
    "soloWedge",
    "适合独立开发的补充方案",
    "一个人能交付的补充工具是什么？如何配合现有产品使用？",
  ],
  [
    "comparisonBlocker",
    "优先级阻断原因",
    "已核对的致命问题或现有功能重合；填写后不参与优先级排名，解决后清空",
  ],
  ["gap", "具体切口", "现有产品在哪个细分工作流留下缺口？"],
  ["offer", "最小可售方案", "第一版交付什么，解决哪一步？"],
  ["monetization", "收入假设", "如何收费？价格与付费意愿尚需什么证据？"],
  ["acquisition", "获客计划", "从哪里接触首批用户？"],
  ["buildEstimate", "开发工期", "按可投入时间估算范围"],
  ["maintenance", "维护负担", "支持、运营与持续维护需要什么？"],
  ["risks", "主要风险", "技术、合规、竞争或依赖风险"],
  ["unknowns", "最大未知", "哪个假设一旦不成立，就不值得继续？"],
] as const;
export const validationFields = [
  ["test", "最小验证动作"],
  ["budget", "预算上限"],
  ["duration", "验证期限"],
  ["success", "成功条件"],
  ["kill", "终止条件"],
] as const;
export const kinds: Record<string, string> = {
  market: "市场",
  pain: "需求 / 痛点",
  revenue: "收入",
  distribution: "获客",
};
export const reviews: Record<string, string> = {
  pending: "待核对",
  accepted: "已接受",
  rejected: "已排除",
};
export const decisionNames: Record<string, string> = {
  WATCH: "继续观察",
  VALIDATE: "开始验证",
  KILL: "放弃机会",
};
export const isKilled = (o: Opportunity) =>
  ["killed", "kill"].includes(o.status.toLowerCase());
export const emptyDossier = (): Dossier =>
  ({
    ...Object.fromEntries(fields.map(([key]) => [key, ""])),
    validation: Object.fromEntries(validationFields.map(([key]) => [key, ""])),
  }) as Dossier;
export function Status({ opportunity: o }: { opportunity: Opportunity }) {
  return (
    <span
      className={
        "ws-tag " +
        (isKilled(o) ? "muted" : o.readiness?.ready ? "green" : "amber")
      }
    >
      {isKilled(o) ? "已放弃" : o.readiness?.ready ? "候选机会" : "待补证草稿"}
    </span>
  );
}
