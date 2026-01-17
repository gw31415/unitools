import { reactRenderer } from "@hono/react-renderer";
import { Link, Script, ViteClient } from "vite-ssr-components/react";

export const renderer = reactRenderer(({ children }) => {
  return (
    <html lang="ja">
      <head>
        <ViteClient />
        <Link href="/src/style.css" rel="stylesheet" />
        <Script src="/src/client.tsx" defer />
      </head>
      <body>{children}</body>
    </html>
  );
});
