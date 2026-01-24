import { yRoute } from "y-durableobjects";
import { createApp } from "@/lib/hono";

const editor = createApp()
  .route(
    "/",
    yRoute<{ Bindings: CloudflareBindings }>((env) => env.UNITOOLS_EDITORS),
  )
  .get("/:id/doc", async (c) => {
    const roomId = c.req.param("id");
    const room = c.env.UNITOOLS_EDITORS.idFromName(roomId);
    const stub = c.env.UNITOOLS_EDITORS.get(room);
    const ydoc = await stub.getYDoc();
    return c.body(ydoc, 200, {
      "Content-Type": "application/octet-stream",
    });
  });

export default editor;
