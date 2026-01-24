import { getSchema } from "@tiptap/core";
import { hc } from "hono/client";
import { Clock, Menu, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";
import Markdown from "@/components/Markdown";
import { headers2Record } from "@/lib/utils";
import type { AppBootstrap } from "@/types/editor";
import { useUser } from "./api/auth";
import { Header } from "./components/Header";
import {
  SideMenu,
  SideMenuProvider,
  SideMenuTrigger,
} from "./components/SideMenu";
import { Button } from "./components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarSeparator,
} from "./components/ui/sidebar";
import { Spinner } from "./components/ui/spinner";
import { serialize } from "./lib/base64";
import { baseExtensions } from "./lib/editorExtensions";
import { createApp } from "./lib/hono";
import type { ServerAppType } from "./server";

const proseMirrorSchema = getSchema(baseExtensions);

export function pathToDocId(path: string) {
  return path.replace(/^\//, "").replace(/\//g, ":");
}

export type AppProps = {
  path: string;
  appBootstrap: AppBootstrap;
};

export function App({ path, appBootstrap }: AppProps) {
  const docId = pathToDocId(path);
  return (
    <SideMenuProvider>
      <div className="h-svh flex flex-col">
        <Header user={appBootstrap.user} />
        <Markdown
          docId={docId}
          bootstrap={{
            snapshotJSON: appBootstrap.snapshotJSON,
            yjsUpdate: appBootstrap.yjsUpdate,
          }}
          className="px-4 py-2 size-full pb-15 md:pb-2"
          aria-label="Main content editor/viewer of this page"
        />
        <SideMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="rounded-full fixed bottom-4 left-4 z-50 md:hidden"
            aria-label="Open drawer menu"
          >
            <Menu />
          </Button>
        </SideMenuTrigger>
      </div>
      <SideMenu className="gap-0 overflow-hidden">
        <SidebarHeader className="shrink-0">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <SidebarInput placeholder="Search articles..." className="pl-9" />
          </div>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarGroup className="min-h-0 flex-1">
          <SidebarGroupLabel>Past articles</SidebarGroupLabel>
          <SidebarGroupContent className="min-h-0 flex-1 overflow-y-auto pr-1">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/article-1">
                    <Clock />
                    <span>Jan 14 — Shipping an editor that feels fast</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuBadge>3m</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/article-2">
                    <Clock />
                    <span>Jan 12 — A tiny design system for Hono</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuBadge>5m</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/article-3">
                    <Clock />
                    <span>Jan 09 — Making markdown feel human</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuBadge>7m</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/article-4">
                    <Clock />
                    <span>Jan 06 — Infinite scroll without losing context</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuBadge>4m</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/article-5">
                    <Clock />
                    <span>Jan 03 — Notes on typography for sidebars</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuBadge>6m</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/article-6">
                    <Clock />
                    <span>Dec 30 — A calmer information hierarchy</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuBadge>8m</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/article-7">
                    <Clock />
                    <span>Dec 28 — Quick wins for content editors</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuBadge>4m</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/article-8">
                    <Clock />
                    <span>Dec 24 — Designing the quiet state</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuBadge>5m</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/article-9">
                    <Clock />
                    <span>Dec 20 — The case for compact menus</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuBadge>2m</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/article-10">
                    <Clock />
                    <span>Dec 16 — Shipping with a light touch</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuBadge>3m</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarLoadingItems />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SideMenu>
    </SideMenuProvider>
  );
}

function SidebarLoadingItems() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      {mounted ? (
        <>
          <SidebarMenuSkeleton showIcon />
          <SidebarMenuSkeleton showIcon />
          <SidebarMenuItem>
            <div className="text-muted-foreground text-xs flex m-2 gap-2">
              <Spinner />
              <span>Loading more articles...</span>
            </div>
          </SidebarMenuItem>
        </>
      ) : null}
    </>
  );
}

const app = createApp()
  .get("/", (c) => c.redirect("/article-1"))
  .get("/:id", useUser, async (c) => {
    const docId = c.req.param("id");

    const client = hc<ServerAppType>(new URL(c.req.url).origin);
    const headers = headers2Record(c.req.raw.headers);
    const res = await client.api.v1.editor[":id"].doc.$get(
      { param: { id: docId } },
      { headers },
    );
    let appBootstrap: AppBootstrap = {
      yjsUpdate: "",
      docId,
      snapshotJSON: undefined,
      user: undefined,
    };
    if (res.ok) {
      const doc = new Y.Doc();
      const yjsUpdateBytes = await res.bytes();
      Y.applyUpdate(doc, yjsUpdateBytes);
      const rootNode = yXmlFragmentToProseMirrorRootNode(
        doc.getXmlFragment("default"),
        proseMirrorSchema,
      );
      appBootstrap = {
        yjsUpdate: serialize(yjsUpdateBytes),
        docId,
        snapshotJSON: rootNode.toJSON(),
        user: c.get("user"),
      };
    }
    const props: AppProps = {
      path: c.req.path,
      appBootstrap: appBootstrap,
    };
    return c.render(<App {...props} />, props);
  });

export default app;
