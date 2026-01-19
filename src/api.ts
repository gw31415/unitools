import { hc } from "hono/client";
import type { YDurableObjectsAppType } from "y-durableobjects";
import { upgrade } from "y-durableobjects/helpers/upgrade";
import { createApp } from "./lib/hono";

const toBase64 = (data: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const api = createApp()
  .get("/page/:id/editor/ws", upgrade(), async (c) => {
    const roomId = c.req.param("id");
    const room = c.env.UNITOOLS_EDITORS.idFromName(roomId);
    const stub = c.env.UNITOOLS_EDITORS.get(room);
    const url = new URL(c.req.url);
    const client = hc<YDurableObjectsAppType>(url.origin, {
      fetch: stub.fetch.bind(stub),
    });
    const res = await client.rooms[":roomId"].$get(
      { param: { roomId } },
      { init: { headers: c.req.raw.headers } },
    );
    return new Response(null, {
      status: res.status,
      statusText: res.statusText,
      webSocket: res.webSocket,
    });
  })
  .get("/page/:id/editor", async (c) => {
    const roomId = c.req.param("id");
    const room = c.env.UNITOOLS_EDITORS.idFromName(roomId);
    const stub = c.env.UNITOOLS_EDITORS.get(room);
    const ydoc = await stub.getYDoc();
    return c.json({ doc: toBase64(ydoc) });
  });

export default api;
