import { hydrateRoot } from "react-dom/client";
import { RouteApp } from "@/app";
import type { InitialRouteState, RouteData } from "@/types/route";

const root = document.querySelector("body");

const readRouteData = (): RouteData => {
  try {
    const json = document.getElementById("route-data")?.textContent;
    if (json) {
      const parsed = JSON.parse(json) as RouteData;
      if (parsed.kind === "auth") {
        return parsed;
      }
      if (parsed.kind === "page" && typeof parsed.docId === "string") {
        return parsed;
      }
    }
  } catch {
    // Ignore malformed route payload.
  }

  return { kind: "auth" };
};

const readRouteState = (): InitialRouteState | undefined => {
  try {
    const json = document.getElementById("route-state")?.textContent;
    if (!json) return undefined;
    const parsed = JSON.parse(json) as InitialRouteState;
    if (typeof parsed.docId !== "string") {
      return undefined;
    }
    return parsed;
  } catch {
    // Ignore malformed state payload.
  }

  return undefined;
};

if (root) {
  const routeData = readRouteData();
  const initialRouteState = readRouteState();
  hydrateRoot(
    root,
    <RouteApp routeData={routeData} initialRouteState={initialRouteState} />,
  );
}
