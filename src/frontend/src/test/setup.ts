import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { notifyManager } from "@tanstack/react-query";

// React Query batches observer notifications on a `setTimeout(0)` by default,
// which lands after `act()` returns; a microtask flushes inside it instead.
notifyManager.setScheduler(queueMicrotask);

// jsdom keeps cookies for the whole file; drop the session cookie between tests
// as test files already do for localStorage (node-environment files have none).
beforeEach(() => {
  if (typeof document === "undefined") return;
  document.cookie = "auth_token=; Path=/; Max-Age=0";
});
