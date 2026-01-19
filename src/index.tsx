import { getSchema, type JSONContent } from "@tiptap/core";
import { Hono } from "hono";
import { hc } from "hono/client";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";
import { App, pathToDocId, renderer } from "@/app";
import { baseExtensions } from "@/lib/editorExtensions";
import type { InitialEditorState } from "@/types/editor";
import api from "./api";

export { YDurableObjects } from "y-durableobjects";

const proseMirrorSchema = getSchema(baseExtensions);

const app = new Hono()
  .use(renderer)
  // Currently development only disallows all robots
  .get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"))
  .route("/api/v1", api)
  .get("*", async (c) => {
    const docId = pathToDocId(c.req.path);
    let initialDocUpdate: string | undefined;
    let initialDocJSON: JSONContent | undefined;

    try {
      const client = hc<typeof app>(c.req.url);
      const headers: Record<string, string> = {};
      c.req.raw.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const res = await client.api.v1.page[":id"].editor.$get(
        { param: { id: docId } },
        { headers },
      );
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
            const fragment = doc.getXmlFragment("default");
            const rootNode = yXmlFragmentToProseMirrorRootNode(
              fragment,
              proseMirrorSchema,
            );
            initialDocJSON = rootNode.toJSON();
          } catch {
            initialDocJSON = undefined;
          }
        }
      }
    } catch {
      // Keep initialDocUpdate empty for SSR if the API is unavailable.
    }

    const initialEditorState: InitialEditorState = {
      initialDocUpdate,
      initialDocId: docId,
      initialDocJSON,
    };

    return c.render(
      <App path={c.req.path} initialEditorState={initialEditorState} />,
      { initialEditorState },
    );
  });

export default app;
