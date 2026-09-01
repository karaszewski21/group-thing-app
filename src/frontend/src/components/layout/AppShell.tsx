import { Box, Flex } from "@chakra-ui/react";
import { useState } from "react";
import { Header } from "./Header";
import { MobileDrawer } from "./MobileDrawer";
import { Sidebar } from "./Sidebar";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <Flex minH="100vh">
      <Sidebar />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <Flex direction="column" flex="1" overflow="auto">
        <Header onMenuOpen={() => setDrawerOpen(true)} />
        <Box as="main" flex="1" px={{ base: "16px", md: "40px" }} py="32px">
          {children}
        </Box>
      </Flex>
    </Flex>
  );
}
