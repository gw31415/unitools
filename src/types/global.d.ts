import "@hono/react-renderer";

declare module "@hono/react-renderer" {
  interface Props {
    ssrState?: Record<string, unknown>;
  }
}
