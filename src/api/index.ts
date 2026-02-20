import { createApp } from "../lib/hono";
import { sessionsApi, usersApi } from "./auth";
import editor from "./editor";
import images from "./images";

const api = createApp()
  .route("/users", usersApi)
  .route("/sessions", sessionsApi)
  .route("/editor", editor)
  .route("/images", images);

export default api;
