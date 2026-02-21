import { getSchema } from "@tiptap/core";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { hc } from "hono/client";
import { getCookie } from "hono/cookie";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { applyUpdate, Doc as YDoc } from "yjs";
import api from "@/api";
import { useUser } from "@/api/auth";
import * as schema from "@/db/schema";
import { bytesToBase64 } from "@/lib/base64";
import { baseExtensions } from "@/lib/editorExtensions";
import type { ULID } from "@/lib/ulid";
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
  .get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /api/*\n"))
  .route("/api/v1", api)
  .get("/editor", useUser, async (c) => {
    // Pass SSR state via props (no editor ID - show welcome page)
    const ssrState: SSRStateType = {
      pageAtom: "EditorPage",
      editorStateAtom: {
        editorId: "",
        createdAt: undefined,
        title: undefined,
        yjsUpdate: undefined,
        snapshotJSON: undefined,
      },
      currentUserAtom: c.get("user"),
      sidebarOpenAtom: getCookieSidebarState(c),
    };

    const Component = await loadComponent(ssrState);
    return c.render(<Component />, { ssrState });
  })
  .get("/editor/:id", useUser, async (c) => {
    const editorId = c.req.param("id");
    const db = drizzle(c.env.DB, { schema });
    const editorMeta = await db.query.editors.findFirst({
      where: eq(schema.editors.id, editorId as ULID),
      columns: {
        createdAt: true,
        title: true,
      },
    });
    if (!editorMeta) {
      return c.notFound();
    }
    const title = editorMeta.title ?? undefined;
    const createdAt =
      editorMeta.createdAt instanceof Date
        ? editorMeta.createdAt.getTime()
        : Number(editorMeta.createdAt);

    const client = hc<ServerAppType>(new URL(c.req.url).origin);
    const headers = headers2Record(c.req.raw.headers);
    const res = await client.api.v1.editor[":id"].doc.$get(
      { param: { id: editorId } },
      { headers },
    );

    if (!res.ok) {
      return c.notFound();
    }

    const doc = new YDoc();
    const yjsUpdateBytes = await res.bytes();
    applyUpdate(doc, yjsUpdateBytes);
    const rootNode = yXmlFragmentToProseMirrorRootNode(
      doc.getXmlFragment("default"),
      getSchema(baseExtensions),
    );
    const editorState: EditorState = {
      editorId,
      createdAt,
      title,
      yjsUpdate: bytesToBase64(yjsUpdateBytes),
      snapshotJSON: rootNode.toJSON(),
    };

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
        createdAt: undefined,
        title: undefined,
        yjsUpdate: undefined,
        snapshotJSON: undefined,
      },
      currentUserAtom: c.get("user"),
      sidebarOpenAtom: getCookieSidebarState(c),
    };

    const Component = await loadComponent(ssrState);
    return c.render(<Component />, { ssrState });
  })
  .get("/", useUser, async (c) => {
    return c.get("user") ? c.redirect("/editor") : c.redirect("/auth");
  });

export type ServerAppType = typeof serverApp;

export default serverApp;
