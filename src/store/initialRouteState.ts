import type { InitialRouteState, RouteData } from "@/types/route";

export const defaultRouteState: InitialRouteState = {
  docId: "",
  yjsUpdate: "",
  snapshotJSON: undefined,
  user: undefined,
};

export const createFallbackRouteState = (
  routeData: RouteData,
  initialRouteState?: InitialRouteState,
): InitialRouteState =>
  initialRouteState ?? {
    ...defaultRouteState,
    docId: routeData.kind === "page" ? routeData.docId : "",
  };
