import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WarehousePage } from "./pages/WarehousePage";
import { ProductStockTab } from "./pages/ProductStockTab";
import { ProductAvailability } from "./pages/ProductAvailability";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WarehousePage />} />
        <Route path="/product-stock" element={<ProductStockTab />} />
        <Route path="/product-availability" element={<ProductAvailability />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
