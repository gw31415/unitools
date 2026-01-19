import type { JSONContent } from "@tiptap/core";
import "@hono/react-renderer";

type Head = {
  initialDocUpdate: string | undefined;
  initialDocId: string;
  initialDocJSON?: JSONContent | null;
};

declare module "@hono/react-renderer" {
  interface Props extends Head {}
}
