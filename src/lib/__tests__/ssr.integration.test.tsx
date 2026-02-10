import { render } from "@testing-library/react";
import { atom, useAtom } from "jotai";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { createSSRAtomState, SSRProvider } from "../ssr";

describe("SSR Hydration Integration", () => {
  describe("Server to Client Hydration Match", () => {
    beforeEach(() => {
      // Clean up DOM
      const existingElement = document.getElementById("__SSR_STATE__");
      if (existingElement) {
        existingElement.remove();
      }
    });

    it("should render identical content on server and client", () => {
      const userAtom = atom<{ name: string } | null>(null);
      const config = createSSRAtomState({
        user: userAtom,
      });

      function TestApp() {
        const [user] = useAtom(userAtom);
        return (
          <div data-testid="content">
            {user ? `Hello, ${user.name}` : "Not logged in"}
          </div>
        );
      }

      // 1. Server-side rendering
      const ssrState = {
        user: { name: "Alice" },
      };

      // Mock server environment
      // @ts-expect-error
      delete global.window;

      const serverHtml = renderToString(
        <SSRProvider config={config} ssrState={ssrState}>
          <TestApp />
        </SSRProvider>,
      );

      expect(serverHtml).toContain("Hello, Alice");

      // 2. Inject SSR state into DOM (simulating what renderer does)
      // @ts-expect-error
      global.window = { document: global.document };

      const script = document.createElement("script");
      script.id = "__SSR_STATE__";
      script.type = "application/json";
      script.textContent = JSON.stringify(ssrState);
      document.head.appendChild(script);

      // 3. Client-side hydration
      const { getByTestId } = render(
        <SSRProvider config={config}>
          <TestApp />
        </SSRProvider>,
      );

      // 4. Verify content matches
      expect(getByTestId("content")).toHaveTextContent("Hello, Alice");

      // Cleanup
      script.remove();
    });

    it("should handle transition from logged-out to logged-in state", () => {
      const userAtom = atom<{ name: string } | null>(null);
      const config = createSSRAtomState({
        user: userAtom,
      });

      function TestApp() {
        const [user] = useAtom(userAtom);
        return (
          <div>
            <div data-testid="status">{user ? "Logged In" : "Logged Out"}</div>
            {user && <div data-testid="name">{user.name}</div>}
          </div>
        );
      }

      // Server renders with user logged in
      // @ts-expect-error
      delete global.window;

      const ssrState = {
        user: { name: "Bob" },
      };

      const serverHtml = renderToString(
        <SSRProvider config={config} ssrState={ssrState}>
          <TestApp />
        </SSRProvider>,
      );

      expect(serverHtml).toContain("Logged In");
      expect(serverHtml).toContain("Bob");

      // Client hydrates with same state
      // @ts-expect-error
      global.window = { document: global.document };

      const script = document.createElement("script");
      script.id = "__SSR_STATE__";
      script.type = "application/json";
      script.textContent = JSON.stringify(ssrState);
      document.head.appendChild(script);

      const { getByTestId } = render(
        <SSRProvider config={config}>
          <TestApp />
        </SSRProvider>,
      );

      // Should maintain logged-in state after hydration
      expect(getByTestId("status")).toHaveTextContent("Logged In");
      expect(getByTestId("name")).toHaveTextContent("Bob");

      script.remove();
    });

    it("should handle editor content hydration", () => {
      type EditorContent = {
        type: string;
        content: Array<{ type: string; text: string }>;
      };

      const editorAtom = atom<EditorContent | null>(null);
      const config = createSSRAtomState({
        editor: editorAtom,
      });

      function Editor() {
        const [content] = useAtom(editorAtom);
        return (
          <div data-testid="editor">
            {content?.content.map((node) => (
              <p key={node.text}>{node.text}</p>
            ))}
          </div>
        );
      }

      // Server renders with editor content
      // @ts-expect-error
      delete global.window;

      const editorContent = {
        type: "doc",
        content: [
          { type: "paragraph", text: "First paragraph" },
          { type: "paragraph", text: "Second paragraph" },
        ],
      };

      const ssrState = {
        editor: editorContent,
      };

      const serverHtml = renderToString(
        <SSRProvider config={config} ssrState={ssrState}>
          <Editor />
        </SSRProvider>,
      );

      expect(serverHtml).toContain("First paragraph");
      expect(serverHtml).toContain("Second paragraph");

      // Client hydrates
      // @ts-expect-error
      global.window = { document: global.document };

      const script = document.createElement("script");
      script.id = "__SSR_STATE__";
      script.type = "application/json";
      script.textContent = JSON.stringify(ssrState);
      document.head.appendChild(script);

      const { getByTestId } = render(
        <SSRProvider config={config}>
          <Editor />
        </SSRProvider>,
      );

      const editorElement = getByTestId("editor");
      expect(editorElement).toHaveTextContent("First paragraph");
      expect(editorElement).toHaveTextContent("Second paragraph");

      script.remove();
    });

    it("should handle multiple atoms hydration together", () => {
      const userAtom = atom<{ id: string; name: string } | null>(null);
      const editorAtom = atom<{ content: string } | null>(null);
      const settingsAtom = atom<{ theme: string }>({ theme: "light" });

      const config = createSSRAtomState({
        user: userAtom,
        editor: editorAtom,
        settings: settingsAtom,
      });

      function App() {
        const [user] = useAtom(userAtom);
        const [editor] = useAtom(editorAtom);
        const [settings] = useAtom(settingsAtom);

        return (
          <div>
            <div data-testid="user">{user?.name}</div>
            <div data-testid="editor">{editor?.content}</div>
            <div data-testid="theme">{settings.theme}</div>
          </div>
        );
      }

      // Server render
      // @ts-expect-error
      delete global.window;

      const ssrState = {
        user: { id: "1", name: "Charlie" },
        editor: { content: "Document content" },
        settings: { theme: "dark" },
      };

      const serverHtml = renderToString(
        <SSRProvider config={config} ssrState={ssrState}>
          <App />
        </SSRProvider>,
      );

      expect(serverHtml).toContain("Charlie");
      expect(serverHtml).toContain("Document content");
      expect(serverHtml).toContain("dark");

      // Client hydration
      // @ts-expect-error
      global.window = { document: global.document };

      const script = document.createElement("script");
      script.id = "__SSR_STATE__";
      script.type = "application/json";
      script.textContent = JSON.stringify(ssrState);
      document.head.appendChild(script);

      const { getByTestId } = render(
        <SSRProvider config={config}>
          <App />
        </SSRProvider>,
      );

      expect(getByTestId("user")).toHaveTextContent("Charlie");
      expect(getByTestId("editor")).toHaveTextContent("Document content");
      expect(getByTestId("theme")).toHaveTextContent("dark");

      script.remove();
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      const existingElement = document.getElementById("__SSR_STATE__");
      if (existingElement) {
        existingElement.remove();
      }
    });

    it("should handle empty SSR state", () => {
      const testAtom = atom<string>("default");
      const config = createSSRAtomState({
        test: testAtom,
      });

      function TestComponent() {
        const [value] = useAtom(testAtom);
        return <div data-testid="value">{value}</div>;
      }

      // Server with empty state
      // @ts-expect-error
      delete global.window;

      const serverHtml = renderToString(
        <SSRProvider config={config} ssrState={undefined}>
          <TestComponent />
        </SSRProvider>,
      );

      expect(serverHtml).toContain("default");

      // Client with empty state
      // @ts-expect-error
      global.window = { document: global.document };

      const script = document.createElement("script");
      script.id = "__SSR_STATE__";
      script.type = "application/json";
      script.textContent = "{}";
      document.head.appendChild(script);

      const { getByTestId } = render(
        <SSRProvider config={config}>
          <TestComponent />
        </SSRProvider>,
      );

      expect(getByTestId("value")).toHaveTextContent("default");

      script.remove();
    });

    it("should handle content with special characters in SSR state", () => {
      const contentAtom = atom<string>("");
      const config = createSSRAtomState({
        content: contentAtom,
      });

      function TestComponent() {
        const [content] = useAtom(contentAtom);
        return <div data-testid="content">{content}</div>;
      }

      const specialContent = "<script>alert('test')</script>";

      // Server
      // @ts-expect-error
      delete global.window;

      const ssrState = { content: specialContent };
      const serialized = JSON.stringify(ssrState);

      // JSON.stringify preserves the content as-is
      // React will escape it when rendered as script children
      expect(serialized).toContain("<script");

      const _serverHtml = renderToString(
        <SSRProvider config={config} ssrState={ssrState}>
          <TestComponent />
        </SSRProvider>,
      );

      // Client
      // @ts-expect-error
      global.window = { document: global.document };

      const script = document.createElement("script");
      script.id = "__SSR_STATE__";
      script.type = "application/json";
      script.textContent = serialized;
      document.head.appendChild(script);

      const { getByTestId } = render(
        <SSRProvider config={config}>
          <TestComponent />
        </SSRProvider>,
      );

      // Content should be safely rendered as text in the component
      expect(getByTestId("content")).toHaveTextContent(specialContent);

      script.remove();
    });
  });

  describe("First Content Paint Verification", () => {
    it("should render same content before and after hydration", () => {
      const userAtom = atom<{ name: string } | null>(null);
      const config = createSSRAtomState({
        user: userAtom,
      });

      function TestComponent() {
        const [user] = useAtom(userAtom);
        return (
          <div data-testid="greeting">
            {user ? `Welcome, ${user.name}!` : "Please log in"}
          </div>
        );
      }

      // 1. Server renders with user
      // @ts-expect-error
      delete global.window;

      const ssrState = {
        user: { name: "Dave" },
      };

      const serverHtml = renderToString(
        <SSRProvider config={config} ssrState={ssrState}>
          <TestComponent />
        </SSRProvider>,
      );

      // First Content Paint should show "Welcome, Dave!"
      expect(serverHtml).toContain("Welcome, Dave!");
      expect(serverHtml).not.toContain("Please log in");

      // 2. Client hydrates
      // @ts-expect-error
      global.window = { document: global.document };

      const script = document.createElement("script");
      script.id = "__SSR_STATE__";
      script.type = "application/json";
      script.textContent = JSON.stringify(ssrState);
      document.head.appendChild(script);

      const { getByTestId } = render(
        <SSRProvider config={config}>
          <TestComponent />
        </SSRProvider>,
      );

      // After hydration should STILL show "Welcome, Dave!"
      expect(getByTestId("greeting")).toHaveTextContent("Welcome, Dave!");
      expect(getByTestId("greeting")).not.toHaveTextContent("Please log in");

      script.remove();
    });
  });
});
