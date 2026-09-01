import { Box } from "@chakra-ui/react";

export type ScopeValue = 1 | 2 | 3 | "mixed";

interface ScopeChipProps {
  scope: ScopeValue;
}

const TOKEN_MAP: Record<ScopeValue, { bg: string; fg: string }> = {
  1: { bg: "scope1.bg", fg: "scope1.fg" },
  2: { bg: "scope2.bg", fg: "scope2.fg" },
  3: { bg: "scope3.bg", fg: "scope3.fg" },
  mixed: { bg: "scopeMixed.bg", fg: "scopeMixed.fg" },
};

export function ScopeChip({ scope }: ScopeChipProps) {
  const tokens = TOKEN_MAP[scope];
  const label = scope === "mixed" ? "mixed" : `Scope ${scope}`;
  return (
    <Box
      as="span"
      data-scope={String(scope)}
      display="inline-block"
      px="8px"
      py="2px"
      borderRadius="10px"
      fontSize="11px"
      fontWeight="500"
      bg={tokens.bg}
      color={tokens.fg}
    >
      {label}
    </Box>
  );
}
