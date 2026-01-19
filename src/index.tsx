import { Hono } from "hono";
import { App, renderer } from "@/app";
import api from "./api";

export { YDurableObjects } from "y-durableobjects";

const app = new Hono()
  .use(renderer)
  // Currently development only disallows all robots
  .get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"))
  .route("/api/v1", api)
  .get("*", (c) => c.render(<App path={c.req.path} />));

export default app;
