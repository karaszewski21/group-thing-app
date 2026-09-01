import { Box, Text } from "@chakra-ui/react";
import { formatCO2eKg } from "../../utils/format";
import { ScopeChip, type ScopeValue } from "./ScopeChip";

interface ScopeBarProps {
  label: string;
  kgCo2: number;
  total: number;
  scope: ScopeValue;
}

export function ScopeBar({ label, kgCo2, total, scope }: ScopeBarProps) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (kgCo2 / total) * 100)) : 0;
  const widthStyle = `${pct}%`;

  return (
    <Box
      data-testid="scope-bar-row"
      display="grid"
      gridTemplateColumns="140px 1fr auto auto"
      alignItems="center"
      gap="12px"
      py="6px"
    >
      <Text fontSize="13px">{label}</Text>
      <Box
        data-testid="scope-bar-track"
        bg="gray.100"
        borderRadius="3px"
        height="14px"
        width="100%"
      >
        <Box
          data-testid="scope-bar-fill"
          bg="brand.500"
          height="14px"
          borderRadius="3px"
          style={{ width: widthStyle }}
        />
      </Box>
      <Text fontFamily="mono" fontSize="13px" textAlign="right">
        {formatCO2eKg(kgCo2)}
      </Text>
      <ScopeChip scope={scope} />
    </Box>
  );
}
