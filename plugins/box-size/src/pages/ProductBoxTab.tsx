import { useEffect, useState } from "react";
import { getSDK } from "../../../sdk";
import type { BoxDimensions } from "../domain";
import { toBoxDimensions } from "../domain";

export function ProductBoxTab() {
  const sdk = getSDK();
  const productId = sdk.thisPlugin.productId ?? "";

  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) {
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const data = (await sdk.thisPlugin.getData(productId)) as Record<string, unknown> | null;
        const box = toBoxDimensions(data);
        if (box) {
          setLength(String(box.length));
          setWidth(String(box.width));
          setHeight(String(box.height));
        }
      } catch {
        // no data yet
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [productId]);

  async function handleSave() {
    setError(null);
    const l = parseFloat(length);
    const w = parseFloat(width);
    const h = parseFloat(height);
    if (isNaN(l) || isNaN(w) || isNaN(h) || l <= 0 || w <= 0 || h <= 0) {
      setError("All dimensions must be positive numbers.");
      return;
    }

    setSaving(true);
    try {
      const dims: BoxDimensions = { length: l, width: w, height: h };
      await sdk.thisPlugin.setData(productId, dims as unknown as Record<string, unknown>);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save box dimensions.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    setError(null);
    try {
      await sdk.thisPlugin.removeData(productId);
      setLength("");
      setWidth("");
      setHeight("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove box dimensions.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="tc-plugin" style={{ padding: "1rem" }}>Loading...</div>;

  const labelStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.75rem" };
  const labelTextStyle: React.CSSProperties = { width: 60, fontSize: "13px", fontWeight: 500, color: "#334155" };
  const inputStyle: React.CSSProperties = { width: 100 };

  return (
    <div className="tc-plugin" style={{ padding: "1.5rem" }}>
      <h3 style={{ margin: "0 0 1rem" }}>Box Dimensions (cm)</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        <label style={labelStyle}>
          <span style={labelTextStyle}>Length</span>
          <input className="tc-input" type="number" min="0" step="any" value={length} onChange={(e) => setLength(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <span style={labelTextStyle}>Width</span>
          <input className="tc-input" type="number" min="0" step="any" value={width} onChange={(e) => setWidth(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <span style={labelTextStyle}>Height</span>
          <input className="tc-input" type="number" min="0" step="any" value={height} onChange={(e) => setHeight(e.target.value)} style={inputStyle} />
        </label>
      </div>
      {error && <p className="tc-error">{error}</p>}
      <div className="tc-flex" style={{ marginTop: "1rem" }}>
        <button className="tc-primary-button" onClick={handleSave} disabled={saving}>
          {saved ? "Saved!" : "Save"}
        </button>
        <button className="tc-ghost-button tc-ghost-button--danger" onClick={handleRemove} disabled={saving}>
          Remove
        </button>
      </div>
    </div>
  );
}
