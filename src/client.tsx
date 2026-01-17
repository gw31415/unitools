import { hydrateRoot } from "react-dom/client";
import { App } from ".";

const root = document.querySelector("body");

if (root) {
  hydrateRoot(root, <App />);
}
