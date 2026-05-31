import { reactRenderer } from "@hono/react-renderer";
import { Link, Script, ViteClient } from "vite-ssr-components/react";
import { SSRProvider } from "@/lib/ssr";
import { ssrAtomState } from "@/store";

const iosStartupScreens = [
  { size: "640x1136", width: 320, height: 568, dpr: 2 },
  { size: "750x1334", width: 375, height: 667, dpr: 2 },
  { size: "1242x2208", width: 414, height: 736, dpr: 3 },
  { size: "1242x2208", width: 621, height: 1104, dpr: 3 },
  { size: "1125x2436", width: 375, height: 812, dpr: 3 },
  { size: "828x1792", width: 414, height: 896, dpr: 2 },
  { size: "1242x2688", width: 414, height: 896, dpr: 3 },
  { size: "1170x2532", width: 390, height: 844, dpr: 3 },
  { size: "1179x2556", width: 393, height: 852, dpr: 3 },
  { size: "1206x2622", width: 402, height: 874, dpr: 3 },
  { size: "1284x2778", width: 428, height: 926, dpr: 3 },
  { size: "1290x2796", width: 430, height: 932, dpr: 3 },
  { size: "1320x2868", width: 440, height: 956, dpr: 3 },
  { size: "1488x2266", width: 744, height: 1133, dpr: 2 },
  { size: "1536x2048", width: 768, height: 1024, dpr: 2 },
  { size: "1620x2160", width: 810, height: 1080, dpr: 2 },
  { size: "1640x2360", width: 820, height: 1180, dpr: 2 },
  { size: "1668x2224", width: 834, height: 1112, dpr: 2 },
  { size: "1668x2388", width: 834, height: 1194, dpr: 2 },
  { size: "2048x2732", width: 1024, height: 1366, dpr: 2 },
];

export const renderer = reactRenderer(({ children, ssrState }) => {
  const title = ssrState?.documentTitleAtom ?? "Unitools: compose knowledge with ease";
  const description = "WYSIWYG Markdown editor for seamless content creation;";

  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta name="description" content={description} />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-touch-fullscreen" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Unitools" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />

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
        {iosStartupScreens.flatMap(({ size, width, height, dpr }) =>
          (["light", "dark"] as const).map((colorScheme) => (
            <link
              key={`${size}-${width}-${height}-${dpr}-${colorScheme}`}
              rel="apple-touch-startup-image"
              href={`/pwa-splash/${size}-${colorScheme}.png`}
              media={`(prefers-color-scheme: ${colorScheme}) and (device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${dpr})`}
            />
          )),
        )}
        <link rel="manifest" href="/manifest.webmanifest" />

        <Link href="/src/style.css" rel="stylesheet" />
        <script id="__SSR_STATE__" type="application/json">
          {JSON.stringify(ssrState || {})}
        </script>
        <Script src="/src/client.tsx" defer />
      </head>
      <body>
        <SSRProvider config={ssrAtomState} ssrState={ssrState}>
          {children}
        </SSRProvider>
      </body>
    </html>
  );
});
