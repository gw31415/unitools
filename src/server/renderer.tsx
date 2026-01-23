import { reactRenderer } from "@hono/react-renderer";
import { Link, Script, ViteClient } from "vite-ssr-components/react";

export const renderer = reactRenderer(({ children, initialEditorState }) => {
  const title = "Unitools: compose knowledge with ease";
  const description = "WYSIWYG Markdown editor for seamless content creation.";
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        <meta name="description" content={description} />

        {/* OGPタグ */}
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        {/* <meta property="og:url" content="サイトURL" /> */}
        {/* <meta property="og:image" content="サムネイル画像のURL" /> */}
        <meta property="og:site_name" content="Unitools" />
        {/* <meta name="twitter:card" content="summary_large_image" /> */}
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {/* <meta name="twitter:image" content="サムネイル画像のURL" /> */}
        <title>{title}</title>

        <ViteClient />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/icon.svg" sizes="any" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        <Link href="/src/style.css" rel="stylesheet" />
        <Script src="/src/client.tsx" defer />
        <script type="application/json" id="initial-editor-state">
          {JSON.stringify(initialEditorState)}
        </script>
      </head>
      <body>{children}</body>
    </html>
  );
});
