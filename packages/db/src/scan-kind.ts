// Classify historical plans without rewriting their reports or collection records.
export const scanKindSql = `CASE
 WHEN plan ? 'reanalysisOf' THEN 'reanalysis'
 WHEN plan->>'kind' IN ('full','x','reddit','reanalysis') THEN plan->>'kind'
 WHEN plan->'xBrowser'->>'reason'='浏览器专项采集' THEN 'x'
 WHEN plan->'redditBrowser'->>'reason'='浏览器专项采集' THEN 'reddit'
 ELSE 'full' END`;
