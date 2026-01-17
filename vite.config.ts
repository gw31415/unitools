import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import ssrPlugin from "vite-ssr-components/plugin";
import tsconfig from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfig(), cloudflare(), tailwindcss(), ssrPlugin()],
});
