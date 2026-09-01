import { useEffect, useState } from "react";
import { getSDK } from "../../../sdk";

export function ProductAvailability() {
  const [available, setAvailable] = useState<boolean | null>(null);
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
        setAvailable(data?.stock === true);
      } catch {
        setAvailable(null);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [productId]);

  if (loading) return null;
  if (available === null) return null;

  return (
    <span className={`tc-badge ${available ? "tc-badge--success" : "tc-badge--danger"}`}>
      {available ? "Product available" : "Product unavailable"}
    </span>
  );
}
