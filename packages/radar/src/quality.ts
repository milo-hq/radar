/** Deterministic publication rules: a second model pass alone is not a quality gate. */
export function publicationBlocker(r: {
  buyer: string;
  title: string;
  solution: string;
  whyPriority: string;
  problem: string;
}) {
  if (
    /政府|司法机构|官方调查|情报|军方|国防|government|intelligence agenc|official investigation/i.test(
      r.buyer,
    )
  )
    return "依赖机构采购与专业合规，不能作为普通独立开发者首选";
  if (
    /端到端|全流程|全自动主导|多场景.*RPA|跨系统流程自动适配|大而全/i.test(
      r.title + r.solution,
    )
  )
    return "产品范围过大，尚未收敛为可独立交付的窄工具";
  if (
    /市场空白|无成熟.*方案|没有竞品|现有方案均无法|付费意愿高|强烈需求|需求强烈|多行业存在明显需求|市场空间较大|市场潜力大|唯一性强|普遍反映|证明需求存在|明显竞争差异化|用户愿为.*付费/.test(
      r.whyPriority + r.problem,
    )
  )
    return "包含原文抽样无法证明的市场、付费或竞品断言";
  return null;
}
export function publishReviewedReport<
  T extends {
    title: string;
    buyer: string;
    solution: string;
    whyPriority: string;
    problem: string;
  },
>(recommendations: T[], analyzed: number) {
  const rejected = recommendations.flatMap((r) => {
    const reason = publicationBlocker(r);
    return reason ? [`${r.title}：${reason}`] : [];
  });
  const kept = recommendations.filter((r) => !publicationBlocker(r));
  return {
    recommendations: kept,
    summary: kept.length
      ? `本轮分析 ${analyzed} 份材料，保留 ${kept.length} 个待验证方向。建议先验证「${kept[0].title}」；以下排序是基于本轮材料的初步判断，需求广度、付费意愿及竞品缺口仍需核实。`
      : `本轮分析 ${analyzed} 份材料，尚未找到证据与单人可行性同时达标的产品机会。暂不建议投入开发。`,
    rejectedSummary: `已剔除无直接痛点依据、现有功能或技术问题等弱建议；最终发布检查另排除 ${rejected.length} 项。${rejected.join("；")}。未通过不等于没有市场，只表示本轮材料不足以支持推荐。`,
  };
}

/** Conservative lexical tripwire, not a general classifier. Model review still applies. */
export function demandEvidenceBlocker(quote: string) {
  if (
    /\b(?:comments?|customers?|users?|people)\b[\s\S]{0,80}\b(?:said|told|reported|complained)\b|\bboth said\b|用户反馈说|客户告诉我|评论说/i.test(
      quote,
    )
  )
    return "作者转述反馈，缺少可追溯的使用者原始抱怨";
  if (
    /\b(?:actually building software|we are (?:building|capturing|launching)|(?:i|we) (?:built|launched|released) (?:our|my|an?|the) (?:tool|app|platform|software))\b|sign up today|try our|我们(?:推出|发布|正在开发)|我发布了/i.test(
      quote,
    )
  )
    return "供给方产品描述或宣传，不能作为独立买方需求证据";
  return null;
}
