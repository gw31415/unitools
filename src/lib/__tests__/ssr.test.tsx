import { render } from "@testing-library/react";
import { atom, useAtom } from "jotai";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { createSSRAtomState, SSRProvider } from "../ssr";

describe("createSSRConfig", () => {
  it("should create SSR configuration from atom map", () => {
    const testAtom = atom<string>("test");
    const numberAtom = atom<number>(42);

    const config = createSSRAtomState({
      test: testAtom,
      number: numberAtom,
    });

    expect(config).toEqual({
      test: testAtom,
      number: numberAtom,
    });
  });
});

describe("SSRProvider - Server Side", () => {
  // Mock server environment
  beforeEach(() => {
    // @ts-expect-error - mocking window
    delete global.window;
  });

  it("should create store with provided ssrState on server", () => {
    const testAtom = atom<string>("default");
    const config = createSSRAtomState({
      test: testAtom,
    });

    function TestComponent() {
      const [value] = useAtom(testAtom);
      return <div>{value}</div>;
    }

    const ssrState = { test: "server-value" };
    const html = renderToString(
      <SSRProvider config={config} ssrState={ssrState}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(html).toContain("server-value");
  });

  it("should create empty store when no ssrState provided on server", () => {
    const testAtom = atom<string>("default");
    const config = createSSRAtomState({
      test: testAtom,
    });

    function TestComponent() {
      const [value] = useAtom(testAtom);
      return <div>{value}</div>;
    }

    const html = renderToString(
      <SSRProvider config={config}>
        <TestComponent />
      </SSRProvider>,
    );

    // Should use default value when no ssrState
    expect(html).toContain("default");
  });

  it("should handle multiple atoms on server", () => {
    const stringAtom = atom<string>("string-default");
    const numberAtom = atom<number>(0);
    const booleanAtom = atom<boolean>(false);

    const config = createSSRAtomState({
      str: stringAtom,
      num: numberAtom,
      bool: booleanAtom,
    });

    function TestComponent() {
      const [str] = useAtom(stringAtom);
      const [num] = useAtom(numberAtom);
      const [bool] = useAtom(booleanAtom);
      return (
        <div>
          {str}-{num}-{bool.toString()}
        </div>
      );
    }

    const ssrState = {
      str: "test",
      num: 42,
      bool: true,
    };

    const html = renderToString(
      <SSRProvider config={config} ssrState={ssrState}>
        <TestComponent />
      </SSRProvider>,
    );

    // React adds HTML comments between text nodes, so we check each part
    expect(html).toContain("test");
    expect(html).toContain("42");
    expect(html).toContain("true");
  });
});

describe("SSRProvider - Client Side", () => {
  beforeEach(() => {
    // Mock browser environment
    // @ts-expect-error - mocking window
    global.window = { document: global.document };

    // Clean up any existing SSR state
    const existingElement = document.getElementById("__SSR_STATE__");
    if (existingElement) {
      existingElement.remove();
    }
  });

  it("should hydrate from __SSR_STATE__ script tag on client", () => {
    const testAtom = atom<string>("default");
    const config = createSSRAtomState({
      test: testAtom,
    });

    // Mock SSR state in DOM
    const script = document.createElement("script");
    script.id = "__SSR_STATE__";
    script.type = "application/json";
    script.textContent = JSON.stringify({ test: "hydrated-value" });
    document.head.appendChild(script);

    function TestComponent() {
      const [value] = useAtom(testAtom);
      return <div data-testid="value">{value}</div>;
    }

    const { getByTestId } = render(
      <SSRProvider config={config}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(getByTestId("value")).toHaveTextContent("hydrated-value");
  });

  it("should handle missing __SSR_STATE__ on client", () => {
    const testAtom = atom<string>("default");
    const config = createSSRAtomState({
      test: testAtom,
    });

    function TestComponent() {
      const [value] = useAtom(testAtom);
      return <div data-testid="value">{value}</div>;
    }

    const { getByTestId } = render(
      <SSRProvider config={config}>
        <TestComponent />
      </SSRProvider>,
    );

    // Should use default value when no SSR state
    expect(getByTestId("value")).toHaveTextContent("default");
  });

  it("should handle multiple atoms on client", () => {
    const stringAtom = atom<string>("default");
    const numberAtom = atom<number>(0);

    const config = createSSRAtomState({
      str: stringAtom,
      num: numberAtom,
    });

    const script = document.createElement("script");
    script.id = "__SSR_STATE__";
    script.type = "application/json";
    script.textContent = JSON.stringify({ str: "hydrated", num: 99 });
    document.head.appendChild(script);

    function TestComponent() {
      const [str] = useAtom(stringAtom);
      const [num] = useAtom(numberAtom);
      return <div data-testid="value">{`${str}-${num}`}</div>;
    }

    const { getByTestId } = render(
      <SSRProvider config={config}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(getByTestId("value")).toHaveTextContent("hydrated-99");
  });

  it("should handle malformed JSON gracefully", () => {
    const testAtom = atom<string>("default");
    const config = createSSRAtomState({
      test: testAtom,
    });

    const script = document.createElement("script");
    script.id = "__SSR_STATE__";
    script.type = "application/json";
    script.textContent = "{ invalid json }";
    document.head.appendChild(script);

    function TestComponent() {
      const [value] = useAtom(testAtom);
      return <div data-testid="value">{value}</div>;
    }

    const { getByTestId } = render(
      <SSRProvider config={config}>
        <TestComponent />
      </SSRProvider>,
    );

    // Should fall back to default value
    expect(getByTestId("value")).toHaveTextContent("default");
    // Note: console.error was called during JSON.parse failure (verified by error log)
  });

  it("should only hydrate atoms present in config", () => {
    const atom1 = atom<string>("default1");
    const atom2 = atom<string>("default2");

    const config = createSSRAtomState({
      atom1: atom1,
    });

    const script = document.createElement("script");
    script.id = "__SSR_STATE__";
    script.type = "application/json";
    script.textContent = JSON.stringify({
      atom1: "hydrated1",
      atom2: "hydrated2", // Not in config
    });
    document.head.appendChild(script);

    function TestComponent() {
      const [val1] = useAtom(atom1);
      const [val2] = useAtom(atom2);
      return (
        <div>
          <span data-testid="val1">{val1}</span>
          <span data-testid="val2">{val2}</span>
        </div>
      );
    }

    const { getByTestId } = render(
      <SSRProvider config={config}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(getByTestId("val1")).toHaveTextContent("hydrated1");
    expect(getByTestId("val2")).toHaveTextContent("default2"); // Not hydrated
  });
});

describe("SSRProvider - Complex Data Types", () => {
  beforeEach(() => {
    // @ts-expect-error
    global.window = { document: global.document };
    const existingElement = document.getElementById("__SSR_STATE__");
    if (existingElement) {
      existingElement.remove();
    }
  });

  it("should handle object values", () => {
    type User = { id: string; name: string };
    const userAtom = atom<User | null>(null);

    const config = createSSRAtomState({
      user: userAtom,
    });

    const script = document.createElement("script");
    script.id = "__SSR_STATE__";
    script.type = "application/json";
    script.textContent = JSON.stringify({
      user: { id: "123", name: "Test User" },
    });
    document.head.appendChild(script);

    function TestComponent() {
      const [user] = useAtom(userAtom);
      return <div data-testid="user">{user?.name}</div>;
    }

    const { getByTestId } = render(
      <SSRProvider config={config}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(getByTestId("user")).toHaveTextContent("Test User");
  });

  it("should handle array values", () => {
    const itemsAtom = atom<number[]>([]);

    const config = createSSRAtomState({
      items: itemsAtom,
    });

    const script = document.createElement("script");
    script.id = "__SSR_STATE__";
    script.type = "application/json";
    script.textContent = JSON.stringify({ items: [1, 2, 3, 4, 5] });
    document.head.appendChild(script);

    function TestComponent() {
      const [items] = useAtom(itemsAtom);
      return <div data-testid="items">{items.join(",")}</div>;
    }

    const { getByTestId } = render(
      <SSRProvider config={config}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(getByTestId("items")).toHaveTextContent("1,2,3,4,5");
  });

  it("should handle nested objects", () => {
    type EditorState = {
      type: string;
      content: Array<{ type: string; text?: string }>;
    };

    const editorAtom = atom<EditorState | null>(null);

    const config = createSSRAtomState({
      editor: editorAtom,
    });

    const editorState = {
      type: "doc",
      content: [{ type: "paragraph", text: "Hello World" }],
    };

    const script = document.createElement("script");
    script.id = "__SSR_STATE__";
    script.type = "application/json";
    script.textContent = JSON.stringify({ editor: editorState });
    document.head.appendChild(script);

    function TestComponent() {
      const [editor] = useAtom(editorAtom);
      return <div data-testid="text">{editor?.content[0]?.text}</div>;
    }

    const { getByTestId } = render(
      <SSRProvider config={config}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(getByTestId("text")).toHaveTextContent("Hello World");
  });
});
