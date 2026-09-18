const languages = [
  ["es", "pt"],
  ["ja", "zh"],
  ["de", "fr"],
  ["ar", "hi"],
];
const storefronts = [
  ["us", "gb", "br", "mx"],
  ["us", "jp", "cn", "kr"],
  ["us", "de", "fr", "es"],
  ["us", "ae", "in", "sa"],
];
export function globalPolicy(round: number) {
  const index = Math.max(0, Math.floor(round)) % languages.length;
  return {
    version: "global-v1",
    audience: "global",
    outputLanguage: "zh-CN",
    searchLanguages: ["en", ...languages[index]],
    storefronts: storefronts[index],
    marketInference: "explicit_source_only",
  };
}
const terms: Record<string, string[]> = {
  en: ["alternative", "missing", "expensive", "frustrating"],
  es: ["alternativa", "falta", "caro", "problema"],
  pt: ["alternativa", "falta", "caro", "problema"],
  ja: ["代替", "不便", "高い", "できない"],
  zh: ["替代", "太贵", "不支持", "不好用"],
  de: ["Alternative", "fehlt", "teuer", "Problem"],
  fr: ["alternative", "manque", "cher", "problème"],
  ar: ["بديل", "مشكلة", "غالي"],
  hi: ["विकल्प", "समस्या", "महंगा"],
};
export function localizedToolQuery(product: string, language: string) {
  return `"${product}" (${(terms[language] ?? terms.en).map((t) => '"' + t + '"').join(" OR ")})`;
}
export type MarketEvidence =
  | { status: "unknown" }
  | { status: "stated"; name: string; quote: string };
export function groundMarket(
  market: { name: string; line: number | null },
  lines: string[],
): MarketEvidence {
  const name = market.name.trim(),
    quote = market.line === null ? undefined : lines[market.line];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Latin-script names must be whole words (US is not 'use'). CJK place names
  // commonly adjoin other characters, so preserve exact substring grounding.
  const matches = /\p{Script=Latin}/u.test(name)
    ? new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(
        quote ?? "",
      )
    : (quote ?? "").includes(name);
  if (
    !name ||
    /^(unknown|global|worldwide|未知|全球)$/i.test(name) ||
    !quote ||
    !matches
  )
    return { status: "unknown" };
  return { status: "stated", name, quote };
}
export function optionalSources(env: Record<string, string | undefined>) {
  return [
    {
      id: "youtube",
      name: "YouTube 评论",
      ready: !!env.YOUTUBE_API_KEY,
      reason: env.YOUTUBE_API_KEY
        ? "已配置，按工具搜索视频与评论"
        : "待配置 YOUTUBE_API_KEY",
    },
    {
      id: "v2ex",
      name: "V2EX 主题与回复",
      ready: !!env.V2EX_ACCESS_TOKEN,
      reason: env.V2EX_ACCESS_TOKEN
        ? "已配置，扫描 apps 节点并按工具过滤"
        : "待配置 V2EX_ACCESS_TOKEN",
    },
    {
      id: "xiaohongshu",
      name: "小红书",
      ready: false,
      reason: "尚未接入；需验证登录态与评论采集",
    },
    { id: "bilibili", name: "B站", ready: false, reason: "尚未接入" },
    {
      id: "g2",
      name: "G2 软件评价",
      ready: false,
      reason: "尚未接入；需数据访问权限",
    },
    { id: "appsumo", name: "AppSumo", ready: false, reason: "尚未接入" },
  ];
}
