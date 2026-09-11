export {};
// Real network ingestion only. No fixtures or synthesized market content.
const base = process.env.RADAR_URL ?? "http://127.0.0.1:4317";
const sources = [
  {
    source: "winner",
    name: "Plausible Analytics",
    url: "https://plausible.io/",
  },
  { source: "winner", name: "Buffer", url: "https://buffer.com/pricing" },
  { source: "winner", name: "Buffer", url: "https://buffer.com/open" },
  { source: "winner", name: "Buttondown", url: "https://buttondown.com/" },
  {
    source: "winner",
    name: "Buttondown",
    url: "https://buttondown.com/pricing",
  },
];
for (const source of sources) {
  const result = await fetch(base + "/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(source),
  });
  const data = await result.json();
  console.log(
    JSON.stringify({
      url: source.url,
      status: result.status,
      jobId: data.id,
      error: data.error,
    }),
  );
  if (!result.ok) process.exitCode = 1;
}
