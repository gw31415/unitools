import { reactRenderer } from "@hono/react-renderer";
import { Menu } from "lucide-react";
import { Link, Script, ViteClient } from "vite-ssr-components/react";
import Markdown from "@/components/Markdown";
import {
  SideMenu,
  SideMenuProvider,
  SideMenuTrigger,
} from "./components/SideMenu";
import { Button } from "./components/ui/button";

export const renderer = reactRenderer(({ children }) => {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
      <div className="min-h-full">
        <SideMenuTrigger asChild className="md:hidden">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="rounded-full fixed bottom-4 left-4 z-50"
          >
            <Menu />
          </Button>
        </SideMenuTrigger>
        <Markdown
          content={`# Markdown Editor\n\nEdit **bold** or *italic* text.\n\nYou access this page at path: \`${path}\`.`}
          className="p-2 container size-full pb-15 md:pb-2"
        />
      </div>
      <SideMenu className="md:min-h-svh md:border-r">
        <a href="/">Overview</a>
        <a href="/projects">Projects</a>
        <a href="/settings">Settings</a>
      </SideMenu>
    </SideMenuProvider>
  );
}
