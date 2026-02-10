import { hydrateRoot } from "react-dom/client";
import { SSRProvider } from "@/lib/ssr";
import { loadComponent } from "@/pages";
import { type SSRStateType, ssrAtomState } from "@/store";

// Read the component name from SSR state
const ssrStateElement = document.getElementById("__SSR_STATE__");

if (!ssrStateElement?.textContent) {
  console.error("[Client] No SSR state found");
} else {
  (async () => {
    try {
      const state: SSRStateType = JSON.parse(ssrStateElement.textContent);

      if (!state) {
        console.error("[Client] No component name in SSR state");
        return;
      }

      // Dynamically load the component
      const root = document.querySelector("body");
      if (root) {
        const Component = await loadComponent(state);
        hydrateRoot(
          root,
          <SSRProvider config={ssrAtomState}>
            <Component />
          </SSRProvider>,
        );
      }
    } catch (error) {
      console.error("[Client] Failed to load component:", error);
    }
  })();
}
