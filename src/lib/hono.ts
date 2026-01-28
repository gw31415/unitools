import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";

export const createApp = () =>
  new Hono<{ Bindings: CloudflareBindings }>().use(trimTrailingSlash());
