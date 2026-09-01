import { Flex, Input, Switch, Text } from "@chakra-ui/react";
import { useRef, useState } from "react";
import type { ResolvedExtensionPoint } from "./PluginContext";

interface PluginFilterBarProps {
  filters: ResolvedExtensionPoint[];
  onFilterChange: (pluginFilters: string[]) => void;
}

export function PluginFilterBar({ filters, onFilterChange }: PluginFilterBarProps) {
  const validFilters = filters.filter((f) => f.filterKey && f.filterType);
  const activeFiltersRef = useRef<Record<string, string>>({});

  if (validFilters.length === 0) return null;

  function handleSingleFilterChange(key: string, filterString: string | undefined) {
    if (filterString) {
      activeFiltersRef.current[key] = filterString;
    } else {
      delete activeFiltersRef.current[key];
    }
    const values = Object.values(activeFiltersRef.current);
    onFilterChange(values.length > 0 ? values : []);
  }

  return (
    <>
      {validFilters.map((filter) => {
        const key = `${filter.pluginId}:${filter.filterKey}`;
        return (
          <PluginFilterControl
            key={key}
            filter={filter}
            onFilterChange={(val) => handleSingleFilterChange(key, val)}
          />
        );
      })}
    </>
  );
}

function PluginFilterControl({
  filter,
  onFilterChange,
}: {
  filter: ResolvedExtensionPoint;
  onFilterChange: (pluginFilter: string | undefined) => void;
}) {
  const [value, setValue] = useState<string | boolean | number | undefined>(
    filter.filterType === "boolean" ? false : undefined,
  );

  function buildFilterString(val: string | boolean | number | undefined): string | undefined {
    if (val === undefined || val === "" || val === false) return undefined;

    const operator = filter.filterType === "boolean" ? "bool" : "eq";
    return `${filter.pluginId}:${filter.filterKey}:${operator}:${val}`;
  }

  if (filter.filterType === "boolean") {
    return (
      <Flex
        align="center"
        gap="8px"
        bg="white"
        border="1px solid"
        borderColor="#E2E8F0"
        borderRadius="8px"
        px="12px"
        h="40px"
      >
        <Switch.Root
          checked={value === true}
          onCheckedChange={(details) => {
            setValue(details.checked);
            onFilterChange(buildFilterString(details.checked));
          }}
          size="sm"
        >
          <Switch.HiddenInput />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Root>
        <Text fontSize="14px" color="#334155" whiteSpace="nowrap">
          {filter.label ?? filter.filterKey}
        </Text>
      </Flex>
    );
  }

  if (filter.filterType === "string") {
    return (
      <Input
        placeholder={filter.label ?? filter.filterKey}
        value={(value as string) ?? ""}
        onChange={(e) => {
          setValue(e.target.value);
          onFilterChange(buildFilterString(e.target.value));
        }}
        bg="white"
        border="1px solid"
        borderColor="#E2E8F0"
        borderRadius="8px"
        px="12px"
        h="40px"
        fontSize="14px"
        maxW="200px"
      />
    );
  }

  if (filter.filterType === "number") {
    return (
      <Input
        type="number"
        placeholder={filter.label ?? filter.filterKey}
        value={(value as string) ?? ""}
        onChange={(e) => {
          const numVal = e.target.value ? Number(e.target.value) : undefined;
          setValue(numVal);
          onFilterChange(buildFilterString(numVal));
        }}
        bg="white"
        border="1px solid"
        borderColor="#E2E8F0"
        borderRadius="8px"
        px="12px"
        h="40px"
        fontSize="14px"
        maxW="160px"
      />
    );
  }

  return null;
}
