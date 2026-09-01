import { useEffect, useState, useCallback } from "react";
import { getSDK } from "../../../sdk";
import { toWarehouse, toStockEntry } from "../domain";
import type { Warehouse, StockEntry, Product } from "../domain";

export function WarehousePage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Warehouse form
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");

  // Stock management
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([]);
  const [stockQuantities, setStockQuantities] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const loadWarehouses = useCallback(async () => {
    try {
      const sdk = getSDK();
      const objects = await sdk.thisPlugin.objects.list("warehouse");
      setWarehouses(objects.map(toWarehouse));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load warehouses");
    }
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      const sdk = getSDK();
      const data = (await sdk.hostApp.getProducts()) as Product[];
      setProducts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
    }
  }, []);

  useEffect(() => {
    Promise.all([loadWarehouses(), loadProducts()]).finally(() => setLoading(false));
  }, [loadWarehouses, loadProducts]);

  const loadStockForProduct = useCallback(async (productId: string) => {
    try {
      const sdk = getSDK();
      const objects = await sdk.thisPlugin.objects.list("stock", { entityType: "PRODUCT", entityId: productId });
      const entries = objects.map(toStockEntry);
      setStockEntries(entries);
      const quantities: Record<string, number> = {};
      for (const entry of entries) {
        quantities[entry.warehouseId] = entry.quantity;
      }
      setStockQuantities(quantities);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stock");
    }
  }, []);

  useEffect(() => {
    if (selectedProductId) {
      void loadStockForProduct(selectedProductId);
    } else {
      setStockEntries([]);
      setStockQuantities({});
    }
  }, [selectedProductId, loadStockForProduct]);

  async function handleAddWarehouse() {
    if (!newName.trim()) return;
    setError(null);
    try {
      const sdk = getSDK();
      const id = crypto.randomUUID();
      await sdk.thisPlugin.objects.save("warehouse", id, { name: newName, address: newAddress });
      setNewName("");
      setNewAddress("");
      await loadWarehouses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add warehouse");
    }
  }

  async function handleDeleteWarehouse(warehouseId: string) {
    setError(null);
    try {
      const sdk = getSDK();
      await sdk.thisPlugin.objects.delete("warehouse", warehouseId);
      await loadWarehouses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete warehouse");
    }
  }

  async function handleSaveStock() {
    if (!selectedProductId) return;
    setSaving(true);
    setError(null);
    try {
      const sdk = getSDK();
      for (const wh of warehouses) {
        const qty = stockQuantities[wh.objectId] ?? 0;
        const objectId = `${selectedProductId}-${wh.objectId}`;
        if (qty > 0) {
          await sdk.thisPlugin.objects.save("stock", objectId, {
            productId: selectedProductId,
            warehouseId: wh.objectId,
            quantity: qty,
          }, { entityType: "PRODUCT", entityId: String(selectedProductId) });
        } else {
          // Remove zero-quantity entries
          const existing = stockEntries.find((e) => e.warehouseId === wh.objectId);
          if (existing) {
            await sdk.thisPlugin.objects.delete("stock", objectId);
          }
        }
      }
      const totalQty = Object.values(stockQuantities).reduce((sum, q) => sum + (q ?? 0), 0);
      await sdk.thisPlugin.setData(selectedProductId, { stock: totalQty > 0 });

      await loadStockForProduct(selectedProductId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save stock");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading...</p>;

  return (
    <div className="tc-plugin" style={{ padding: "1rem", maxWidth: 800 }}>
      <h1>Warehouse Management</h1>
      {error && <p className="tc-error">{error}</p>}

      {/* Warehouses Section */}
      <section className="tc-section">
        <h2>Warehouses</h2>
        <div className="tc-flex" style={{ marginBottom: "1rem" }}>
          <input className="tc-input" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="tc-input" placeholder="Address" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
          <button className="tc-primary-button" onClick={() => void handleAddWarehouse()}>Add</button>
        </div>
        {warehouses.length === 0 ? (
          <p>No warehouses yet. Add one above.</p>
        ) : (
          <table className="tc-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Address</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {warehouses.map((wh) => (
                <tr key={wh.objectId}>
                  <td>{wh.name}</td>
                  <td>{wh.address}</td>
                  <td>
                    <button className="tc-ghost-button tc-ghost-button--danger" onClick={() => void handleDeleteWarehouse(wh.objectId)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Stock Management Section */}
      <section className="tc-section">
        <h2>Stock Management</h2>
        {warehouses.length === 0 ? (
          <p>Add warehouses first to manage stock.</p>
        ) : (
          <>
            <div style={{ marginBottom: "1rem" }}>
              <label>
                Product:{" "}
                <select
                  className="tc-select"
                  value={selectedProductId ?? ""}
                  onChange={(e) => setSelectedProductId(e.target.value || null)}
                >
                  <option value="">-- Select a product --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedProductId && (
              <>
                <table className="tc-table" style={{ marginBottom: "1rem" }}>
                  <thead>
                    <tr>
                      <th>Warehouse</th>
                      <th align="right">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warehouses.map((wh) => (
                      <tr key={wh.objectId}>
                        <td>{wh.name}</td>
                        <td align="right">
                          <input
                            className="tc-input"
                            type="number"
                            min={0}
                            style={{ width: 80 }}
                            value={stockQuantities[wh.objectId] ?? 0}
                            onChange={(e) =>
                              setStockQuantities((prev) => ({
                                ...prev,
                                [wh.objectId]: parseInt(e.target.value, 10) || 0,
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="tc-primary-button" onClick={() => void handleSaveStock()} disabled={saving}>
                  {saving ? "Saving..." : "Save Stock"}
                </button>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
