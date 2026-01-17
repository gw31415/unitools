import { Hono } from "hono";
import { App, renderer } from "@/app";

const app = new Hono();

app.use(renderer);

app.get("/", (c) => c.render(<App />));

export default app;
