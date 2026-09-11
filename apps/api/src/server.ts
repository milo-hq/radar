import "dotenv/config";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import { pool } from "../../../packages/db/src/index.js";
import { buildApp } from "./app.js";
const app = await buildApp(pool);
const root = resolve("dist/web");
if (existsSync(root)) {
  await app.register(fastifyStatic, { root });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/")
      ? reply.code(404).send({ error: "Not found" })
      : reply.sendFile("index.html"),
  );
}
await app.listen({
  port: Number(process.env.PORT ?? 4317),
  host: process.env.HOST ?? "127.0.0.1",
});
console.log("Venture Radar API ready on port " + (process.env.PORT ?? 4317));
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
