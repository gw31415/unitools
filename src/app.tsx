import { reactRenderer } from "@hono/react-renderer";
import { Clock, Menu, PanelLeft, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Script, ViteClient } from "vite-ssr-components/react";
import Markdown from "@/components/Markdown";
import { Logo } from "./components/Logo";
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

function Header() {
  const [scheme, setScheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    setScheme(prefersDark ? "dark" : "light");
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.colorScheme = scheme;
  }, [scheme]);

  return (
    <header className="h-10 flex items-center gap-2 px-2 py-1 border-b">
      <SideMenuTrigger asChild className="hidden md:flex">
        <Button size="icon" variant="ghost">
          <PanelLeft />
        </Button>
      </SideMenuTrigger>
      <Logo className="fill-white py-1 h-full" />
    </header>
  );
}

export const renderer = reactRenderer(({ children }) => {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        <ViteClient />
        <Link href="/src/style.css" rel="stylesheet" />
        <Script src="/src/client.tsx" defer />
      </head>
      <body>{children}</body>
    </html>
  );
});

export function App({ path }: { path: string }) {
  return (
    <SideMenuProvider>
      <div className="h-svh flex flex-col">
        <Header />
        <Markdown
          content={`# Markdown Editor\n\nEdit **bold** or *italic* text.\n\nYou access this page at path: \`${path}\`.`}
          className="px-4 py-2 size-full pb-15 md:pb-2"
        />
        <SideMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="rounded-full fixed bottom-4 left-4 z-50 md:hidden"
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
                  <a href="/">
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
            </SidebarMenu>
            <div className="px-2 py-3">
              <SidebarMenuSkeleton showIcon />
              <SidebarMenuSkeleton showIcon />
              <div className="text-muted-foreground mt-2 text-xs">
                Loading more articles...
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SideMenu>
    </SideMenuProvider>
  );
}
