import { getSchema } from "@tiptap/core";
import { Hono } from "hono";
import { hc } from "hono/client";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";
import api from "@/api";
import { useUser } from "@/api/auth";
import { serialize } from "@/lib/base64";
import { baseExtensions } from "@/lib/editorExtensions";
import { headers2Record } from "@/lib/utils";
import { loadComponent } from "@/pages";
import { renderer } from "@/server/renderer";
import type { SSRStateType } from "@/store";
import type { EditorState } from "@/types/route";

const serverApp = new Hono()
  .use(renderer)
  // Currently development only disallows all robots
  .get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"))
  .route("/api/v1", api)
  .get("/editor/:id", useUser, async (c) => {
    const docId = c.req.param("id");

    const client = hc<ServerAppType>(new URL(c.req.url).origin);
    const headers = headers2Record(c.req.raw.headers);
    const res = await client.api.v1.editor[":id"].doc.$get(
      { param: { id: docId } },
      { headers },
    );

    let editorState: EditorState = {
      docId,
      yjsUpdate: "",
      snapshotJSON: undefined,
    };

    if (res.ok) {
      const doc = new Y.Doc();
      const yjsUpdateBytes = await res.bytes();
      Y.applyUpdate(doc, yjsUpdateBytes);
      const rootNode = yXmlFragmentToProseMirrorRootNode(
        doc.getXmlFragment("default"),
        getSchema(baseExtensions),
      );
      editorState = {
        docId,
        yjsUpdate: serialize(yjsUpdateBytes),
        snapshotJSON: rootNode.toJSON(),
      };
    }

    // Pass SSR state via props
    const ssrState: SSRStateType = {
      pageAtom: "EditorPage",
      editorStateAtom: editorState,
      currentUserAtom: c.get("user"),
    };

    const Component = await loadComponent(ssrState);
    return c.render(<Component />, { ssrState });
  })
  .get("/auth", useUser, async (c) => {
    // Pass SSR state via props
    const ssrState: SSRStateType = {
      pageAtom: "AuthPage",
      editorStateAtom: {
        docId: "",
        yjsUpdate: undefined,
        snapshotJSON: undefined,
      },
      currentUserAtom: c.get("user"),
    };

    const Component = await loadComponent(ssrState);
    return c.render(<Component />, { ssrState });
  });

export type ServerAppType = typeof serverApp;

export default serverApp;
