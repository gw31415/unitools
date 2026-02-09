import { render } from "@testing-library/react";
import { atom, useAtom } from "jotai";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { createSSRConfig, SSRProvider, serializeSSRState } from "../ssr";

describe("createSSRConfig", () => {
  it("should create SSR configuration from atom map", () => {
    const testAtom = atom<string>("test");
    const numberAtom = atom<number>(42);

    const config = createSSRConfig({
      test: { key: "test", atom: testAtom },
      number: { key: "number", atom: numberAtom },
    });

    expect(config.config).toHaveLength(2);
    expect(config.config[0]).toEqual({ key: "test", atom: testAtom });
    expect(config.config[1]).toEqual({ key: "number", atom: numberAtom });
  });

  it("should create getState function that converts values", () => {
    const testAtom = atom<string | undefined>(undefined);

    const config = createSSRConfig({
      test: { key: "test", atom: testAtom },
    });

    const state = config.getState({ test: "value" });
    expect(state).toEqual({ test: "value" });
  });

  it("should convert undefined to null for JSON serialization", () => {
    const testAtom = atom<string | undefined>(undefined);

    const config = createSSRConfig({
      test: { key: "test", atom: testAtom },
    });

    const state = config.getState({ test: undefined });
    expect(state).toEqual({ test: null });
  });

  it("should preserve null values", () => {
    const testAtom = atom<string | null>(null);

    const config = createSSRConfig({
      test: { key: "test", atom: testAtom },
    });

    const state = config.getState({ test: null });
    expect(state).toEqual({ test: null });
  });
});

describe("serializeSSRState", () => {
  it("should serialize object to JSON string", () => {
    const state = { test: "value", number: 42 };
    const serialized = serializeSSRState(state);
    expect(serialized).toBe('{"test":"value","number":42}');
  });

  it("should serialize objects containing < characters", () => {
    const state = { xss: "<script>alert('xss')</script>" };
    const serialized = serializeSSRState(state);
    // React will escape this when used as children
    expect(serialized).toContain("<script");
    expect(JSON.parse(serialized)).toEqual(state);
  });

  it("should handle nested objects", () => {
    const state = {
      user: { id: "123", name: "Test" },
      items: [1, 2, 3],
    };
    const serialized = serializeSSRState(state);
    const parsed = JSON.parse(serialized);
    expect(parsed).toEqual(state);
  });

  it("should handle empty object", () => {
    const serialized = serializeSSRState({});
    expect(serialized).toBe("{}");
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
    const config = createSSRConfig({
      test: { key: "test", atom: testAtom },
    });

    function TestComponent() {
      const [value] = useAtom(testAtom);
      return <div>{value}</div>;
    }

    const ssrState = config.getState({ test: "server-value" });
    const html = renderToString(
      <SSRProvider config={config.config} ssrState={ssrState}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(html).toContain("server-value");
  });

  it("should handle undefined values on server", () => {
    const testAtom = atom<string | undefined>(undefined);
    const config = createSSRConfig({
      test: { key: "test", atom: testAtom },
    });

    function TestComponent() {
      const [value] = useAtom(testAtom);
      return <div>{value ?? "empty"}</div>;
    }

    const ssrState = config.getState({ test: undefined });
    const html = renderToString(
      <SSRProvider config={config.config} ssrState={ssrState}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(html).toContain("empty");
  });

  it("should create empty store when no ssrState provided on server", () => {
    const testAtom = atom<string>("default");
    const config = createSSRConfig({
      test: { key: "test", atom: testAtom },
    });

    function TestComponent() {
      const [value] = useAtom(testAtom);
      return <div>{value}</div>;
    }

    const html = renderToString(
      <SSRProvider config={config.config}>
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

    const config = createSSRConfig({
      str: { key: "str", atom: stringAtom },
      num: { key: "num", atom: numberAtom },
      bool: { key: "bool", atom: booleanAtom },
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

    const ssrState = config.getState({
      str: "test",
      num: 42,
      bool: true,
    });

    const html = renderToString(
      <SSRProvider config={config.config} ssrState={ssrState}>
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
    const config = createSSRConfig({
      test: { key: "test", atom: testAtom },
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
      <SSRProvider config={config.config}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(getByTestId("value")).toHaveTextContent("hydrated-value");
  });

  it("should handle missing __SSR_STATE__ on client", () => {
    const testAtom = atom<string>("default");
    const config = createSSRConfig({
      test: { key: "test", atom: testAtom },
    });

    function TestComponent() {
      const [value] = useAtom(testAtom);
      return <div data-testid="value">{value}</div>;
    }

    const { getByTestId } = render(
      <SSRProvider config={config.config}>
        <TestComponent />
      </SSRProvider>,
    );

    // Should use default value when no SSR state
    expect(getByTestId("value")).toHaveTextContent("default");
  });

  it("should convert null back to undefined on client", () => {
    const testAtom = atom<string | undefined>("default");
    const config = createSSRConfig({
      test: { key: "test", atom: testAtom },
    });

    // Mock SSR state with null (represents undefined)
    const script = document.createElement("script");
    script.id = "__SSR_STATE__";
    script.type = "application/json";
    script.textContent = JSON.stringify({ test: null });
    document.head.appendChild(script);

    function TestComponent() {
      const [value] = useAtom(testAtom);
      return <div data-testid="value">{value ?? "undefined"}</div>;
    }

    const { getByTestId } = render(
      <SSRProvider config={config.config}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(getByTestId("value")).toHaveTextContent("undefined");
  });

  it("should handle multiple atoms on client", () => {
    const stringAtom = atom<string>("default");
    const numberAtom = atom<number>(0);

    const config = createSSRConfig({
      str: { key: "str", atom: stringAtom },
      num: { key: "num", atom: numberAtom },
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
      <SSRProvider config={config.config}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(getByTestId("value")).toHaveTextContent("hydrated-99");
  });

  it("should handle malformed JSON gracefully", () => {
    const testAtom = atom<string>("default");
    const config = createSSRConfig({
      test: { key: "test", atom: testAtom },
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
      <SSRProvider config={config.config}>
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

    const config = createSSRConfig({
      atom1: { key: "atom1", atom: atom1 },
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
      <SSRProvider config={config.config}>
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

    const config = createSSRConfig({
      user: { key: "user", atom: userAtom },
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
      <SSRProvider config={config.config}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(getByTestId("user")).toHaveTextContent("Test User");
  });

  it("should handle array values", () => {
    const itemsAtom = atom<number[]>([]);

    const config = createSSRConfig({
      items: { key: "items", atom: itemsAtom },
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
      <SSRProvider config={config.config}>
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

    const config = createSSRConfig({
      editor: { key: "editor", atom: editorAtom },
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
      <SSRProvider config={config.config}>
        <TestComponent />
      </SSRProvider>,
    );

    expect(getByTestId("text")).toHaveTextContent("Hello World");
  });
});
