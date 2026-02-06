import { atom } from "jotai";
import type { InitialRouteState, RouteData } from "@/types/route";

const defaultRouteData: RouteData = { kind: "auth" };

const defaultRouteState: InitialRouteState = {
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

export const routeDataAtom = atom<RouteData>(defaultRouteData);
export const routeStateAtom = atom<InitialRouteState>(defaultRouteState);

export const isAuthRouteAtom = atom(
  (get) => get(routeDataAtom).kind === "auth",
);
export const currentDocIdAtom = atom((get) => {
  const routeData = get(routeDataAtom);
  return routeData.kind === "page"
    ? routeData.docId
    : get(routeStateAtom).docId;
});
export const currentUserAtom = atom((get) => get(routeStateAtom).user);
export const markdownBootstrapAtom = atom((get) => ({
  snapshotJSON: get(routeStateAtom).snapshotJSON,
  yjsUpdate: get(routeStateAtom).yjsUpdate,
}));
