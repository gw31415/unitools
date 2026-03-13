import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import ssrPlugin from "vite-ssr-components/plugin";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [cloudflare(), tailwindcss(), ssrPlugin()],
});
