import {
  DrawerBackdrop,
  DrawerBody,
  DrawerCloseTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerPositioner,
  DrawerRoot,
  Flex,
  Text,
} from "@chakra-ui/react";
import { Link, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { ProductsIcon, PluginsIcon, KragIcon, CategoriesIcon, ModerationIcon } from "../shared/Icons";
import { useAuth } from "../../auth/AuthContext";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

interface MobileNavItemProps {
  to: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

function MobileNavItem({ to, label, icon: Icon, onClick }: MobileNavItemProps) {
  const location = useLocation();
  const isActive = location.pathname.startsWith(to);

  return (
    <Flex asChild>
      <Link
        to={to}
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 16px",
          margin: "0 12px",
          fontSize: "14px",
          fontWeight: 500,
          textDecoration: "none",
          color: isActive ? "white" : "rgba(255,255,255,0.7)",
          background: isActive ? "rgba(59,130,246,0.35)" : "transparent",
          borderRadius: "8px",
          transition: "all 0.15s",
        }}
      >
        <Icon size={18} />
        {label}
      </Link>
    </Flex>
  );
}

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const { permissions } = useAuth();
  const hasPluginManagement = permissions.includes("PLUGIN_MANAGEMENT");
  const isAdmin = permissions.includes("ADMIN");

  return (
    <DrawerRoot
      open={open}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
      placement="start"
    >
      <DrawerBackdrop />
      <DrawerPositioner>
        <DrawerContent bg="brand.900" color="white" maxW="220px">
          <DrawerHeader borderBottom="none" px="24px" pt="24px" pb="0">
            <Text fontSize="15px" fontWeight="700" letterSpacing="-0.3px" whiteSpace="nowrap">
              <Text as="span" color="brand.400">Group</Text>
              <Text as="span" color="white" fontWeight="800">Thing</Text>
            </Text>
          </DrawerHeader>
          <DrawerBody px="0" pt="16px">
            <Flex as="nav" direction="column" gap="2px" role="navigation" aria-label="Mobile navigation">
              <MobileNavItem to="/products" label="Products" icon={ProductsIcon} onClick={onClose} />
              <MobileNavItem to="/panel" label="Krąg grupy" icon={KragIcon} onClick={onClose} />
              {isAdmin && (
                <MobileNavItem to="/categories" label="Categories" icon={CategoriesIcon} onClick={onClose} />
              )}
              {(hasPluginManagement || isAdmin) && (
                <MobileNavItem to="/plugins" label="Plugins" icon={PluginsIcon} onClick={onClose} />
              )}
              {isAdmin && (
                <MobileNavItem to="/moderation" label="Moderation" icon={ModerationIcon} onClick={onClose} />
              )}
            </Flex>
          </DrawerBody>
          <DrawerCloseTrigger />
        </DrawerContent>
      </DrawerPositioner>
    </DrawerRoot>
  );
}
