import { Hono } from "hono";
import { renderer } from "./renderer";

const app = new Hono();

app.use(renderer);

app.get("/", (c) => {
  return c.render(
    <>
      <h1>Hello, world!</h1>
      <p>こんにちは、世界！</p>
    </>,
  );
});

export default app;
