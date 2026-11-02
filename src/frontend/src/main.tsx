import { ChakraProvider } from "@chakra-ui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { NavigationTracker } from "./routing/NavigationTracker";
import { router } from "./router";
import { system } from "./theme/system";
import { AuthProvider } from "./auth/AuthContext";
import { getQueryClient } from "./api/queryClient";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={getQueryClient()}>
      <ChakraProvider value={system}>
        <AuthProvider>
          <NavigationTracker />
          <RouterProvider router={router} />
        </AuthProvider>
      </ChakraProvider>
    </QueryClientProvider>
  </StrictMode>,
);
