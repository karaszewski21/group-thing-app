import "@testing-library/jest-dom/vitest";
import { notifyManager } from "@tanstack/react-query";

// React Query batches observer notifications on a `setTimeout(0)` by default,
// which lands after `act()` returns; a microtask flushes inside it instead.
notifyManager.setScheduler(queueMicrotask);
