# SSR Hydration Test Suite

Comprehensive Vitest test suite for the Jotai SSR hydration system.

## Setup

### Install Dependencies

```bash
pnpm add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom happy-dom
```

### Add Test Scripts to package.json

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "test:run": "vitest run"
  }
}
```

## Running Tests

### Run all tests in watch mode
```bash
pnpm test
```

### Run tests once (CI mode)
```bash
pnpm test:run
```

### Run tests with UI
```bash
pnpm test:ui
```

### Run tests with coverage report
```bash
pnpm test:coverage
```

### Run specific test file
```bash
pnpm test src/lib/__tests__/ssr.test.tsx
```

### Run tests matching a pattern
```bash
pnpm test -t "SSRProvider"
```

## Test Files

### `src/lib/__tests__/ssr.test.tsx`
Unit tests for SSR utilities:
- ✅ `createSSRConfig()` - Configuration creation and type safety
- ✅ `serializeSSRState()` - JSON serialization and XSS protection
- ✅ `SSRProvider` - Server-side rendering behavior
- ✅ `SSRProvider` - Client-side hydration behavior
- ✅ Complex data types (objects, arrays, nested structures)

**Test Coverage:**
- Creating SSR configuration from atom map
- Converting undefined to null for JSON
- Escaping XSS attempts
- Server-side store creation with ssrState
- Client-side hydration from DOM script tag
- Handling missing or malformed SSR state
- Multiple atoms hydration
- Complex data structures (objects, arrays, nested data)

### `src/lib/__tests__/ssr.integration.test.tsx`
Integration tests for complete SSR→CSR flow:
- ✅ Server to Client Hydration Match - Verifies identical rendering
- ✅ Authentication State Persistence - Login state across hydration
- ✅ Editor Content Hydration - TipTap content preservation
- ✅ Multiple Atoms Together - Complex state hydration
- ✅ Edge Cases - Empty state, XSS, partial state
- ✅ First Content Paint - No flash of wrong content

**Test Coverage:**
- Complete server→client hydration pipeline
- Authentication state persistence through hydration
- Editor content preservation
- Multiple atoms hydrating simultaneously
- Edge cases (empty state, XSS attempts, partial state)
- First Content Paint verification (no flash)

## Test Structure

Each test follows this pattern:

```tsx
describe("Feature", () => {
  beforeEach(() => {
    // Setup test environment (mock window, clean DOM, etc.)
  });

  it("should behave correctly", () => {
    // 1. Arrange - Set up atoms and config
    // 2. Act - Render server/client
    // 3. Assert - Verify behavior
  });
});
```

## Key Test Scenarios

### 1. Server-Side Rendering
```tsx
// Mock server environment
delete global.window;

// Create SSR state
const ssrState = config.getState({ user: { name: "Alice" } });

// Render to string
const html = renderToString(
  <SSRProvider config={config.config} ssrState={ssrState}>
    <App />
  </SSRProvider>
);

// Verify server HTML contains expected content
expect(html).toContain("Alice");
```

### 2. Client-Side Hydration
```tsx
// Mock browser environment
global.window = { document: global.document };

// Inject SSR state into DOM (simulating renderer)
const script = document.createElement("script");
script.id = "__SSR_STATE__";
script.textContent = JSON.stringify({ user: { name: "Alice" } });
document.head.appendChild(script);

// Hydrate
const { getByTestId } = render(
  <SSRProvider config={config.config}>
    <App />
  </SSRProvider>
);

// Verify hydrated content matches
expect(getByTestId("user")).toHaveTextContent("Alice");
```

### 3. Server→Client Integration
```tsx
// 1. Server render with state
const ssrState = config.getState({ user: { name: "Bob" } });
delete global.window;
const serverHtml = renderToString(<SSRProvider ssrState={ssrState}>...</SSRProvider>);

// 2. Inject state into DOM
global.window = { document: global.document };
const script = document.createElement("script");
script.id = "__SSR_STATE__";
script.textContent = serializeSSRState(ssrState);
document.head.appendChild(script);

// 3. Client hydration
const { getByTestId } = render(<SSRProvider>...</SSRProvider>);

// 4. Verify match
expect(serverHtml).toContain("Bob");
expect(getByTestId("user")).toHaveTextContent("Bob");
```

## What Each Test Validates

### Unit Tests (`ssr.test.tsx`)

#### `createSSRConfig()`
- ✅ Creates configuration from atom map
- ✅ Generates correct config array
- ✅ Creates type-safe getState function
- ✅ Converts undefined → null for JSON
- ✅ Preserves null values

#### `serializeSSRState()`
- ✅ Serializes objects to JSON
- ✅ Escapes `<` to prevent XSS
- ✅ Handles nested objects
- ✅ Handles empty objects

#### `SSRProvider` (Server)
- ✅ Creates store with provided ssrState
- ✅ Renders with correct atom values
- ✅ Handles undefined values
- ✅ Falls back to defaults when no ssrState
- ✅ Handles multiple atoms

#### `SSRProvider` (Client)
- ✅ Reads from `__SSR_STATE__` script tag
- ✅ Hydrates atoms correctly
- ✅ Converts null → undefined
- ✅ Handles missing SSR state gracefully
- ✅ Handles malformed JSON
- ✅ Only hydrates configured atoms

#### Complex Data Types
- ✅ Objects (user profiles)
- ✅ Arrays (lists of items)
- ✅ Nested objects (editor content)

### Integration Tests (`ssr.integration.test.tsx`)

#### Server→Client Hydration
- ✅ Identical content on server and client
- ✅ Login state persistence
- ✅ Editor content hydration
- ✅ Multiple atoms together

#### Edge Cases
- ✅ Empty SSR state
- ✅ XSS prevention
- ✅ Partial state (some atoms undefined)

#### First Content Paint
- ✅ No flash between server render and hydration
- ✅ Same content before and after hydration

## Coverage Goals

Target coverage: **90%+**

### Current Coverage Areas:
- ✅ Function coverage: All exported functions
- ✅ Branch coverage: Error paths, edge cases
- ✅ Line coverage: All execution paths
- ✅ Integration: Complete SSR→CSR pipeline

### To check coverage:
```bash
pnpm test:coverage
```

Coverage report will be generated in `coverage/` directory.

## Debugging Tests

### Enable verbose output
```bash
pnpm test --reporter=verbose
```

### Debug specific test
```bash
pnpm test --reporter=verbose -t "should render identical content"
```

### Run tests in UI mode for interactive debugging
```bash
pnpm test:ui
```

## Common Issues

### Issue: "window is not defined"
**Cause:** Test is running in wrong environment (server vs client)

**Fix:**
```tsx
beforeEach(() => {
  // For server tests
  delete global.window;

  // For client tests
  global.window = { document: global.document };
});
```

### Issue: "Cannot find __SSR_STATE__"
**Cause:** Script tag not injected into DOM

**Fix:**
```tsx
const script = document.createElement("script");
script.id = "__SSR_STATE__";
script.textContent = JSON.stringify(state);
document.head.appendChild(script);
```

### Issue: Tests pass but coverage is low
**Cause:** Missing edge case tests

**Fix:** Add tests for:
- Error conditions
- Missing data
- Malformed input
- Boundary values

## Continuous Integration

### GitHub Actions Example
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm test:run
      - run: pnpm test:coverage
      - uses: codecov/codecov-action@v4
        with:
          files: ./coverage/coverage-final.json
```

## Best Practices

1. **Test Behavior, Not Implementation**
   - Focus on what users see, not internal details
   - Test that content appears correctly, not how atoms are set

2. **Isolate Tests**
   - Each test should be independent
   - Use `beforeEach` to reset state
   - Clean up DOM after tests

3. **Use Descriptive Names**
   - `it("should render user name after hydration")` ✅
   - `it("test hydration")` ❌

4. **Test Edge Cases**
   - Missing data
   - Malformed input
   - Empty states
   - XSS attempts

5. **Keep Tests Fast**
   - Mock heavy dependencies
   - Avoid unnecessary async operations
   - Use `vi.fn()` for function mocks

## Next Steps

After running tests successfully:

1. ✅ Verify all tests pass
2. ✅ Check coverage report (aim for 90%+)
3. ✅ Add tests for any new features
4. ✅ Set up CI pipeline
5. ✅ Add pre-commit hook to run tests

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [Jotai Testing](https://jotai.org/docs/guides/testing)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
