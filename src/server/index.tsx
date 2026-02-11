import { getSchema } from "@tiptap/core";
import type { Context } from "hono";
import { Hono } from "hono";
import { hc } from "hono/client";
import { getCookie } from "hono/cookie";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { applyUpdate, Doc as YDoc } from "yjs";
import api from "@/api";
import { useUser } from "@/api/auth";
import { bytesToBase64 } from "@/lib/base64";
import { baseExtensions } from "@/lib/editorExtensions";
import { headers2Record } from "@/lib/utils";
import type { EditorState } from "@/models";
import { loadComponent } from "@/pages";
import { renderer } from "@/server/renderer";
import type { SSRStateType } from "@/store";

const SIDEBAR_COOKIE_NAME = "sidebar_state";

/**
 * Get sidebar open state from cookie
 */
function getCookieSidebarState(c: Context) {
  const cookieValue = getCookie(c, SIDEBAR_COOKIE_NAME);
  if (cookieValue === "true") return true;
  if (cookieValue === "false") return false;
  return true; // Default to open
}

const serverApp = new Hono()
  .use(renderer)
  // Currently development only disallows all robots
  .get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"))
  .route("/api/v1", api)
  .get("/editor/:id", useUser, async (c) => {
    const editorId = c.req.param("id");

    const client = hc<ServerAppType>(new URL(c.req.url).origin);
    const headers = headers2Record(c.req.raw.headers);
    const res = await client.api.v1.editor[":id"].doc.$get(
      { param: { id: editorId } },
      { headers },
    );

    let editorState: EditorState = {
      editorId: "",
      yjsUpdate: "",
      snapshotJSON: undefined,
    };

    if (res.ok) {
      const doc = new YDoc();
      const yjsUpdateBytes = await res.bytes();
      applyUpdate(doc, yjsUpdateBytes);
      const rootNode = yXmlFragmentToProseMirrorRootNode(
        doc.getXmlFragment("default"),
        getSchema(baseExtensions),
      );
      editorState = {
        editorId,
        yjsUpdate: bytesToBase64(yjsUpdateBytes),
        snapshotJSON: rootNode.toJSON(),
      };
    }

    // Pass SSR state via props
    const ssrState: SSRStateType = {
      pageAtom: "EditorPage",
      editorStateAtom: editorState,
      currentUserAtom: c.get("user"),
      sidebarOpenAtom: getCookieSidebarState(c),
    };

    const Component = await loadComponent(ssrState);
    return c.render(<Component />, { ssrState });
  })
  .get("/auth", useUser, async (c) => {
    // Pass SSR state via props
    const ssrState: SSRStateType = {
      pageAtom: "AuthPage",
      editorStateAtom: {
        editorId: "",
        yjsUpdate: undefined,
        snapshotJSON: undefined,
      },
      currentUserAtom: c.get("user"),
      sidebarOpenAtom: getCookieSidebarState(c),
    };

    const Component = await loadComponent(ssrState);
    return c.render(<Component />, { ssrState });
  });

export type ServerAppType = typeof serverApp;

export default serverApp;
