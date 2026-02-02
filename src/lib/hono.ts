import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";

export type Env = { Bindings: CloudflareBindings };

export const createApp = () => new Hono<Env>().use(trimTrailingSlash());
