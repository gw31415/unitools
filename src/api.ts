import { yRoute } from "y-durableobjects";
import { createApp } from "./lib/hono";

const api = createApp()
  .route(
    "/editor",
    yRoute<{ Bindings: CloudflareBindings }>((env) => env.UNITOOLS_EDITORS),
  )
  .get("/editor/:id/state", async (c) => {
    const roomId = c.req.param("id");
    const room = c.env.UNITOOLS_EDITORS.idFromName(roomId);
    const stub = c.env.UNITOOLS_EDITORS.get(room);
    const ydoc = await stub.getYDoc();
    return c.body(ydoc, undefined, {
      "Content-Type": "application/octet-stream",
    });
  });

export default api;
