import { hydrateRoot } from "hono/jsx/dom/client";
import { App } from ".";

const root = document.querySelector("body");

if (root) {
  hydrateRoot(root, <App />);
}
