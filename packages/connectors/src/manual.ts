import { load } from "cheerio";
import type {
  DiscoveredItem,
  RawDocumentInput,
  SourceConnector,
} from "../../core/src/documents.js";
import { fetchPublic } from "./http.js";
export class ManualURLConnector implements SourceConnector {
  constructor(
    private sourceKey: "manual" | "winner" = "manual",
    private urls: string[] = [],
  ) {}
  async discover() {
    return this.urls.map((url) => ({ url }));
  }
  async fetch(item: DiscoveredItem): Promise<RawDocumentInput> {
    const page = await fetchPublic(item.url);
    let body = page.text,
      title = "";
    if (page.contentType.includes("html")) {
      ({ body, title } = extractHtml(page.text));
    } else if (!page.contentType.includes("text/plain"))
      throw new Error("Expected an HTML or plain text market page");
    if (
      body.length < 100 ||
      /^(just a moment|access denied|verify you are human|attention required)/i.test(
        title,
      )
    )
      throw new Error(
        "Page has insufficient usable content or an access challenge",
      );
    return {
      sourceKey: this.sourceKey,
      externalId: page.url,
      canonicalUrl: page.url,
      type: this.sourceKey === "winner" ? "product" : "article",
      title,
      body,
      metadata: {
        acquisition: "public_fetch",
        requestedUrl: item.url,
        contentType: page.contentType,
        rawPayload: page.text,
      },
    };
  }
}

export function extractHtml(html: string) {
  const $ = load(html);
  const title = $("title").first().text().trim();
  $("script,style,noscript,nav,footer,header,svg").remove();
  $("br").replaceWith("\n");
  $("h1,h2,h3,h4,h5,h6,p,div,li,section,article,tr").append("\n");
  const main = $("main").first();
  const body = (main.length ? main : $("body"))
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
  return { title, body };
}
