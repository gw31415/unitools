import "@hono/react-renderer";
import type { InitialEditorState } from "@/types/editor";

type Head = {
  initialEditorState?: InitialEditorState;
};

declare module "@hono/react-renderer" {
  interface Props extends Head {}
}
