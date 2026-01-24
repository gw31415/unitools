import { createApp } from "../lib/hono";
import auth from "./auth";
import editor from "./editor";

const api = createApp().route("/auth", auth).route("/editor", editor);

export default api;
