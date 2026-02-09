import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: vi.fn(),
  warn: vi.fn(),
  error: console.error, // Keep error for debugging
};
