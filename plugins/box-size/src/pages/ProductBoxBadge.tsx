import { useEffect, useState } from "react";
import { getSDK } from "../../../sdk";
import { toBoxDimensions, formatBox } from "../domain";

export function ProductBoxBadge() {
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const sdk = getSDK();
  const productId = sdk.thisPlugin.productId ?? "";

  useEffect(() => {
    if (!productId) {
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const data = (await sdk.thisPlugin.getData(productId)) as Record<string, unknown> | null;
        const box = toBoxDimensions(data);
        if (box) setLabel(formatBox(box));
      } catch {
        // no data yet
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [productId]);

  if (loading || !label) return null;

  return <span className="tc-badge tc-badge--success">{label}</span>;
}
