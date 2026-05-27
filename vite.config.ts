import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite-plus";
import ssrPlugin from "vite-ssr-components/plugin";

const ignorePatterns = ["src/components/ui/**", "worker-configuration.d.ts"];

function clientOnlyPWA(): Plugin[] {
  return VitePWA({
    injectRegister: false,
    registerType: "autoUpdate",
    includeAssets: ["favicon.ico", "icon.svg", "apple-touch-icon.png"],
    manifest: {
      name: "Unitools",
      short_name: "Unitools",
      description: "WYSIWYG Markdown editor for seamless content creation",
      theme_color: "#ffffff",
      background_color: "#ffffff",
      display: "standalone",
      icons: [
        {
          src: "/pwa-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "/pwa-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
        {
          src: "/pwa-512x512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    workbox: {
      cleanupOutdatedCaches: true,
    },
  }).map((plugin) => ({
    ...plugin,
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
  }));
}

function ssrEntryForRolldown(): Plugin {
  return {
    name: "ssr-entry-for-rolldown",
    enforce: "post",
    config(config) {
      config.environments ??= {};
      config.environments.ssr ??= {};
      config.environments.ssr.build ??= {};
      config.environments.ssr.build.emptyOutDir = false;
      config.environments.ssr.build.rollupOptions ??= {};
      config.environments.ssr.build.rollupOptions.input = "src/index.tsx";
    },
  };
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    ...(process.env.VITEST === "true" ? [] : [cloudflare()]),
    tailwindcss(),
    ssrPlugin(),
    ssrEntryForRolldown(),
    ...clientOnlyPWA(),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "src/__tests__/", "*.config.ts", "dist/"],
    },
  },
  lint: { ignorePatterns },
  fmt: {
    sortImports: {
      newlinesBetween: false,
    },
    sortTailwindcss: {
      stylesheet: "src/style.css",
      functions: ["clsx", "cn"],
      preserveWhitespace: true,
    },
    sortPackageJson: {
      sortScripts: true,
    },
    ignorePatterns: [...ignorePatterns, "src/*.css"],
  },
});
