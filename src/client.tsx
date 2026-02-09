import { hydrateRoot } from "react-dom/client";
import { DocumentPage } from "@/app";
import { SSRProvider } from "@/lib/ssr";
import { ssrConfig } from "@/store/routeState";
import AuthPage from "./app/auth";

const root = document.querySelector("body");

if (root) {
  // Determine which component was rendered on the server based on URL
  const path = window.location.pathname;
  const Component = path.startsWith("/pages/") ? DocumentPage : AuthPage;

  hydrateRoot(
    root,
    <SSRProvider config={ssrConfig.config}>
      <Component />
    </SSRProvider>,
  );
}
