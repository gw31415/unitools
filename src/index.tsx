import { Hono } from "hono";
import { App, renderer } from "@/app";

const app = new Hono()
  .use(renderer)
  .get("*", (c) => c.render(<App path={c.req.path} />));

export default app;
