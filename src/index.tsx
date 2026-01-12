import { Hono } from "hono";
import { renderer } from "./renderer";

const app = new Hono();

app.use(renderer);

app.get("/", (c) => {
  return c.render(<App />);
});

export function App() {
  return <p>Hello, world!</p>;
}

export default app;
