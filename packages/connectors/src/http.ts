import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
export function assertPublicAddress(ip: string) {
  const addr = ipaddr.process(ip);
  if (addr.range() !== "unicast")
    throw new Error("Private or reserved network addresses are not allowed");
}
export function assertPublicUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Only public HTTP(S) URLs without credentials are allowed");
  if (url.port && !["80", "443"].includes(url.port))
    throw new Error("Only standard web ports are allowed");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (!host.includes(".") && !isIP(host))
  )
    throw new Error("Local hostnames are not allowed");
  if (isIP(host)) assertPublicAddress(host);
  return url;
}
export async function fetchPublic(
  value: string,
  headers: Record<string, string> = {},
  redirects = 0,
): Promise<{ url: string; text: string; contentType: string }> {
  const url = assertPublicUrl(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true });
  if (!addresses.length) throw new Error("DNS returned no addresses");
  addresses.forEach((a) => assertPublicAddress(a.address));
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        headers: {
          "User-Agent": "VentureRadar/0.1 (market research)",
          Accept: "text/html,application/json,text/plain",
          ...headers,
        },
        lookup: ((_hostname: unknown, options: any, cb: any) =>
          options?.all
            ? cb(null, [address])
            : cb(null, address.address, address.family)) as any,
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
          res.resume();
          if (redirects >= 3 || !res.headers.location)
            return reject(new Error("Redirect limit exceeded"));
          const target = new URL(res.headers.location, url);
          const nextHeaders = { ...headers };
          if (target.origin !== url.origin) {
            delete nextHeaders.Authorization;
            delete nextHeaders.authorization;
          }
          fetchPublic(target.href, nextHeaders, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Source HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 2_000_000) {
            req.destroy(new Error("Source exceeds 2 MB limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            url: url.href,
            text: Buffer.concat(chunks).toString("utf8"),
            contentType: String(res.headers["content-type"] ?? ""),
          }),
        );
      },
    );
    const deadline = setTimeout(
      () => req.destroy(new Error("Source timed out after 20 seconds")),
      20_000,
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    req.end();
  });
}
