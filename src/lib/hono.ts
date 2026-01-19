import { Hono } from "hono";

export const createApp = () => new Hono<{ Bindings: CloudflareBindings }>();
