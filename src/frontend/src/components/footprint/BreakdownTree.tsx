import { useMemo, useState } from "react";
import { Box, Table, Text } from "@chakra-ui/react";
import type { BreakdownDto, CompositeDto, LeafDto, WarningDto } from "../../api/footprints";
import { formatCO2eKg } from "../../utils/format";
import { ScopeChip } from "./ScopeChip";

interface BreakdownTreeProps {
  root: BreakdownDto;
  total: number;
}

function collectCompositeIds(node: BreakdownDto, acc: Set<string>): void {
  if (node.type === "composite") {
    acc.add(node.componentId);
    for (const child of node.children) {
      collectCompositeIds(child, acc);
    }
  }
}

function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function pct(value: number, total: number): string {
  if (total <= 0) return "—";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function WarningsList({ warnings }: { warnings: WarningDto[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <Box mt="2px">
      {warnings.map((w) => (
        <Text key={w.code + w.message} fontSize="11px" color="orange.700">
          ⚠ {w.message}
        </Text>
      ))}
    </Box>
  );
}

interface RowProps {
  node: BreakdownDto;
  depth: number;
  total: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  parentVisible: boolean;
}

function renderRows({
  node,
  depth,
  total,
  expanded,
  toggle,
  parentVisible,
}: RowProps): React.ReactNode[] {
  if (node.type === "composite") {
    return [
      <CompositeRow
        key={`c-${node.componentId}`}
        node={node}
        depth={depth}
        total={total}
        expanded={expanded.has(node.componentId)}
        toggle={toggle}
        hidden={!parentVisible}
      />,
      ...node.children.flatMap((child) =>
        renderRows({
          node: child,
          depth: depth + 1,
          total,
          expanded,
          toggle,
          parentVisible: parentVisible && expanded.has(node.componentId),
        }),
      ),
    ];
  }
  return [
    <LeafRow
      key={`l-${node.componentId}`}
      node={node}
      depth={depth}
      total={total}
      hidden={!parentVisible}
    />,
  ];
}

function CompositeRow({
  node,
  depth,
  total,
  expanded,
  toggle,
  hidden,
}: {
  node: CompositeDto;
  depth: number;
  total: number;
  expanded: boolean;
  toggle: (id: string) => void;
  hidden: boolean;
}) {
  const groupId = `breakdown-group-${safeId(node.componentId)}`;
  return (
    <Table.Row hidden={hidden} bg="gray.50" fontWeight="500">
      <Table.Cell style={{ paddingLeft: `${12 + depth * 20}px` }}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={groupId}
          onClick={() => toggle(node.componentId)}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            font: "inherit",
            cursor: "pointer",
            color: "inherit",
          }}
        >
          <span aria-hidden="true">{expanded ? "▼" : "▶"}</span> {node.componentId}
        </button>
        <WarningsList warnings={node.warnings} />
      </Table.Cell>
      <Table.Cell fontFamily="mono" textAlign="right">
        {formatCO2eKg(node.kgCo2)}
      </Table.Cell>
      <Table.Cell textAlign="right">{pct(node.kgCo2, total)}</Table.Cell>
      <Table.Cell>—</Table.Cell>
      <Table.Cell>—</Table.Cell>
      <Table.Cell>—</Table.Cell>
    </Table.Row>
  );
}

function LeafRow({
  node,
  depth,
  total,
  hidden,
}: {
  node: LeafDto;
  depth: number;
  total: number;
  hidden: boolean;
}) {
  return (
    <Table.Row hidden={hidden} title={`Factor source: ${node.factorVersionId}`}>
      <Table.Cell style={{ paddingLeft: `${12 + depth * 20}px` }}>
        {node.componentId}
        <WarningsList warnings={node.warnings} />
      </Table.Cell>
      <Table.Cell fontFamily="mono" textAlign="right">
        {formatCO2eKg(node.kgCo2)}
      </Table.Cell>
      <Table.Cell textAlign="right">{pct(node.kgCo2, total)}</Table.Cell>
      <Table.Cell>
        <ScopeChip scope={node.scope} />
      </Table.Cell>
      <Table.Cell fontFamily="mono">{node.factorRate}</Table.Cell>
      <Table.Cell fontFamily="mono">{node.factorValidFrom}</Table.Cell>
    </Table.Row>
  );
}

export function BreakdownTree({ root, total }: BreakdownTreeProps) {
  const initialExpanded = useMemo(() => {
    const acc = new Set<string>();
    collectCompositeIds(root, acc);
    return acc;
  }, [root]);
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // The root composite itself is always rendered "visible"; its children
  // visibility is driven by whether root is in `expanded`.
  const rows =
    root.type === "composite"
      ? root.children.flatMap((child) =>
          renderRows({
            node: child,
            depth: 0,
            total,
            expanded,
            toggle,
            parentVisible: true,
          }),
        )
      : renderRows({
          node: root,
          depth: 0,
          total,
          expanded,
          toggle,
          parentVisible: true,
        });

  return (
    <Table.Root size="sm" variant="line">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Component</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="right">kg CO₂</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="right">% of total</Table.ColumnHeader>
          <Table.ColumnHeader>Scope</Table.ColumnHeader>
          <Table.ColumnHeader>Factor</Table.ColumnHeader>
          <Table.ColumnHeader>Valid from</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>{rows}</Table.Body>
    </Table.Root>
  );
}
