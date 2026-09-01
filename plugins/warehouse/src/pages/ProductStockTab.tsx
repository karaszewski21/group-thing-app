import { useEffect, useState } from "react";
import { getSDK } from "../../../sdk";
import { toWarehouse, toStockEntry } from "../domain";
import type { Warehouse, StockEntry } from "../domain";

export function ProductStockTab() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sdk = getSDK();
  const productId = sdk.thisPlugin.productId ?? "";

  useEffect(() => {
    if (!productId) {
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const [whObjects, stockObjects] = await Promise.all([
          sdk.thisPlugin.objects.list("warehouse"),
          sdk.thisPlugin.objects.list("stock", { entityType: "PRODUCT", entityId: productId }),
        ]);
        setWarehouses(whObjects.map(toWarehouse));
        setStockEntries(stockObjects.map(toStockEntry));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load stock data");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [productId]);

  if (!productId) return <p>No product context available.</p>;
  if (loading) return <p>Loading stock info...</p>;
  if (error) return <p className="tc-error">{error}</p>;

  const stockByWarehouse = new Map(stockEntries.map((e) => [e.warehouseId, e.quantity]));
  const totalStock = stockEntries.reduce((sum, e) => sum + e.quantity, 0);

  if (warehouses.length === 0) {
    return (
      <div className="tc-plugin" style={{ padding: "1rem" }}>
        <h2>Stock Info</h2>
        <p>No warehouses configured. Add warehouses in the Warehouse page first.</p>
      </div>
    );
  }

  return (
    <div className="tc-plugin" style={{ padding: "1rem" }}>
      <h2>Stock Info</h2>
      <table className="tc-table" style={{ marginBottom: "1rem" }}>
        <thead>
          <tr>
            <th>Warehouse</th>
            <th align="right">Quantity</th>
          </tr>
        </thead>
        <tbody>
          {warehouses.map((wh) => {
            const qty = stockByWarehouse.get(wh.objectId) ?? 0;
            return (
              <tr key={wh.objectId}>
                <td>{wh.name}</td>
                <td align="right">{qty}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td align="right">{totalStock}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
