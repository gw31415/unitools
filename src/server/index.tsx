import { Hono } from "hono";
import app from "@/app";
import api from "../api";
import { renderer } from "./renderer";

const serverApp = new Hono()
  .use(renderer)
  // Currently development only disallows all robots
  .get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"))
  .route("/api/v1", api)
  .route("/", app);

export type ServerAppType = typeof serverApp;

export default serverApp;
