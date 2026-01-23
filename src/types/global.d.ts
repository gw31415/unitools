import "@hono/react-renderer";
import type { AppBootstrap } from "@/types/editor";

type Head = {
  appBootstrap?: AppBootstrap;
};

declare module "@hono/react-renderer" {
  interface Props extends Head {}
}
