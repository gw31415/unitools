import { Hono } from "hono";
import { App, renderer } from "@/app";

const app = new Hono()
  .use(renderer)
  // Currently development only disallows all robots
  .get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"))
  .get("*", (c) => c.render(<App path={c.req.path} />));

export default app;
