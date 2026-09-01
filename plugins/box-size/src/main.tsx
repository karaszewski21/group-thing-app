import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProductBoxTab } from "./pages/ProductBoxTab";
import { ProductBoxBadge } from "./pages/ProductBoxBadge";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/product-box" element={<ProductBoxTab />} />
        <Route path="/product-box-badge" element={<ProductBoxBadge />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
