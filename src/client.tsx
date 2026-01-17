/// <reference lib="dom" />
import { hydrateRoot } from "hono/jsx/dom/client";
import { App } from ".";
import "basecoat-css/all";

const root = document.querySelector("body");

if (root) {
  hydrateRoot(root, <App />);
}
