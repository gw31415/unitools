import { hydrateRoot } from "react-dom/client";
import { SSRProvider } from "@/lib/ssr";
import { loadComponent } from "@/pages";
import { type SSRStateType, ssrAtomState } from "@/store";

function reserveHydrationHeight(): () => void {
  const body = document.body;
  const previousMinHeight = body.style.minHeight;
  const height = Math.max(
    body.getBoundingClientRect().height,
    body.scrollHeight,
    document.documentElement.scrollHeight,
  );
  if (height > 0) {
    body.style.minHeight = `${height}px`;
  }

  return () => {
    body.style.minHeight = previousMinHeight;
  };
}

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
      const Component = await loadComponent(state);
      const releaseReservedHeight = reserveHydrationHeight();
      hydrateRoot(
        document.body,
        <SSRProvider config={ssrAtomState}>
          <Component />
        </SSRProvider>,
      );

      window.setTimeout(() => {
        releaseReservedHeight();
      }, 1000);
    } catch (error) {
      console.error("[Client] Failed to load component:", error);
    }
  })();
}
