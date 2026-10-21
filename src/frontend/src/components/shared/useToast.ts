import { useEffect, useState } from "react";

const TOAST_MS = 2600;

/** A single self-clearing status message. */
export function useToast() {
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  return { toast, showToast: setToast };
}
