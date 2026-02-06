import "@hono/react-renderer";
import type { InitialRouteState, RouteData } from "@/types/route";

type Head = {
  routeData?: RouteData;
  initialRouteState?: InitialRouteState;
};

declare module "@hono/react-renderer" {
  interface Props extends Head {}
}
