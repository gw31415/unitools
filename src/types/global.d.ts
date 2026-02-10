import type { SSRStateType } from "@/store";
import "@hono/react-renderer";

declare module "@hono/react-renderer" {
  interface Props {
    ssrState?: SSRStateType;
  }
}
