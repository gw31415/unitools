import { Hono } from "hono";
import { Markdown } from "./components/Markdown";
import { renderer } from "./renderer";

const app = new Hono();

app.use(renderer);

app.get("/", (c) => {
  return c.render(<App />);
});

export function App() {
  return (
    <Markdown
      content={"# Markdown Editor\n\nEdit **bold** or *italic* text."}
    />
  );
}

export default app;
