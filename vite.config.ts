import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import ssrPlugin from "vite-ssr-components/plugin";

const ignorePatterns = ["src/components/ui/**", "worker-configuration.d.ts"];

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [cloudflare(), tailwindcss(), ssrPlugin()],
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
