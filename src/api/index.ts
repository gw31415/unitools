import { createApp } from "../lib/hono";
import { sessionsApi, usersApi } from "./auth";
import editor from "./editor";

const api = createApp()
  .route("/users", usersApi)
  .route("/sessions", sessionsApi)
  .route("/editor", editor);

export default api;
