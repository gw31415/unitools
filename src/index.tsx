import { Hono } from "hono";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import { App, pathToDocId, renderer } from "@/app";
import api from "./api";

export { YDurableObjects } from "y-durableobjects";

const app = new Hono()
  .use(renderer)
  // Currently development only disallows all robots
  .get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"))
  .route("/api/v1", api)
  .get("*", async (c) => {
    const docId = pathToDocId(c.req.path);
    let initialDocUpdate;
    let initialDocJSON = null;

    try {
      const apiUrl = new URL(
        `/api/v1/page/${encodeURIComponent(docId)}/editor`,
        c.req.url,
      );
      const res = await fetch(apiUrl, { headers: c.req.raw.headers });
      if (res.ok) {
        const data = (await res.json()) as { doc?: string };
        if (data.doc) {
          initialDocUpdate = data.doc;
          try {
            const doc = new Y.Doc();
            const binary = atob(data.doc);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
              bytes[i] = binary.charCodeAt(i);
            }
            Y.applyUpdate(doc, bytes);
            initialDocJSON = yDocToProsemirrorJSON(doc, "default");
          } catch {
            initialDocJSON = null;
          }
        }
      }
    } catch {
      // Keep initialDocUpdate empty for SSR if the API is unavailable.
    }

    return c.render(
      <App
        path={c.req.path}
        initialDocUpdate={initialDocUpdate}
        initialDocJSON={initialDocJSON}
      />,
      {
        initialDocUpdate,
        initialDocId: docId,
        initialDocJSON,
      },
    );
  });

export default app;
