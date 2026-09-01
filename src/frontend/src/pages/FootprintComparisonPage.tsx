import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Table,
  Text,
} from "@chakra-ui/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getProduct } from "../api/products";
import type { ProductResponse } from "../api/products";
import {
  getFootprintCsvExport,
  type BreakdownDto,
  type FootprintQueryInput,
} from "../api/footprints";
import {
  useFootprintComparison,
  type ScenarioState,
} from "../hooks/useFootprintComparison";
import { decodeScenario, encodeScenario, type ScenarioInput } from "../utils/scenarioUrl";
import { downloadBlob } from "../utils/download";
import { extractProblemMessage } from "../api/problem";
import { formatCO2eKg } from "../utils/format";

const MAX_SCENARIOS = 4;
const SCENARIO_LETTERS = ["A", "B", "C", "D"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface LeafTotals {
  [componentId: string]: number;
}

/**
 * Flatten the breakdown tree to a map of leaf componentId → kgCo2 sum.
 * We collapse repeated leaf ids defensively (sum) so the delta table tolerates
 * either tree shape (composite root with named children, or a single leaf root).
 */
function collectLeafTotals(node: BreakdownDto, acc: LeafTotals): void {
  if (node.type === "composite") {
    // Treat the first level under root as the "component" — Materials / Transport / etc.
    // For comparison purposes we sum each top-level composite by its componentId.
    for (const child of node.children) {
      acc[child.componentId] = (acc[child.componentId] ?? 0) + child.kgCo2;
    }
    return;
  }
  acc[node.componentId] = (acc[node.componentId] ?? 0) + node.kgCo2;
}

function leafTotalsFor(scenario: ScenarioState): LeafTotals {
  const acc: LeafTotals = {};
  if (scenario.data) collectLeafTotals(scenario.data.breakdown, acc);
  return acc;
}

function buildDefaultScenario(product: ProductResponse | null): FootprintQueryInput {
  // Spec FR-3: when URL has no valid s=, derive a single baseline scenario from
  // product defaults. We deliberately keep this minimal — the backend supplies
  // defaults for fields we don't echo here.
  return {
    asOf: todayIso(),
    storageDays: 0,
    unit: "TOTAL",
    ...(product ? {} : {}),
  };
}

function scenarioInputToQuery(input: ScenarioInput): FootprintQueryInput {
  const q: FootprintQueryInput = {};
  if (input.asOf !== undefined) q.asOf = input.asOf;
  if (input.materialWeightKg !== undefined) q.materialWeightKg = input.materialWeightKg;
  if (input.supplierDistanceKm !== undefined) q.supplierDistanceKm = input.supplierDistanceKm;
  if (input.destinationDistanceKm !== undefined) q.destinationDistanceKm = input.destinationDistanceKm;
  if (input.lastMileDistanceKm !== undefined) q.lastMileDistanceKm = input.lastMileDistanceKm;
  if (input.storageDays !== undefined) q.storageDays = input.storageDays;
  if (input.requiresRefrigeration !== undefined)
    q.requiresRefrigeration = input.requiresRefrigeration;
  if (input.unit !== undefined) q.unit = input.unit;
  return q;
}

function queryToScenarioInput(q: FootprintQueryInput): ScenarioInput {
  const s: ScenarioInput = {};
  if (q.asOf !== undefined) s.asOf = q.asOf;
  if (q.materialWeightKg !== undefined) s.materialWeightKg = q.materialWeightKg;
  if (q.supplierDistanceKm !== undefined) s.supplierDistanceKm = q.supplierDistanceKm;
  if (q.destinationDistanceKm !== undefined) s.destinationDistanceKm = q.destinationDistanceKm;
  if (q.lastMileDistanceKm !== undefined) s.lastMileDistanceKm = q.lastMileDistanceKm;
  if (q.storageDays !== undefined) s.storageDays = q.storageDays;
  if (q.requiresRefrigeration !== undefined) s.requiresRefrigeration = q.requiresRefrigeration;
  if (q.unit !== undefined) s.unit = q.unit;
  return s;
}

function scenarioTitle(index: number, input: FootprintQueryInput): string {
  const letter = SCENARIO_LETTERS[index] ?? String(index + 1);
  const date = input.asOf ?? todayIso();
  const km = input.destinationDistanceKm ?? 0;
  return `Scenario ${letter} — ${date} / ${km} km`;
}

function deltaPct(value: number, base: number): number | null {
  if (base <= 0) return null;
  return ((value - base) / base) * 100;
}

interface MiniBarRow {
  label: string;
  componentId: string;
  kgCo2: number;
}

const MINI_BAR_COMPONENTS = ["Materials", "Transport", "Packaging", "Cold storage"];

function miniBarRows(totals: LeafTotals): MiniBarRow[] {
  return MINI_BAR_COMPONENTS.map((label) => ({
    label,
    componentId: label,
    kgCo2: totals[label] ?? 0,
  }));
}

export function FootprintComparisonPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // --- Product (for breadcrumb / header) ---
  const [product, setProduct] = useState<ProductResponse | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getProduct(Number(id))
      .then((p) => {
        if (!cancelled) setProduct(p);
      })
      .catch(() => {
        /* breadcrumb falls back to id */
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // --- Parse cg + initial scenarios from URL (once on mount) ---
  // We freeze the initial parse so that local state changes (add/remove) don't
  // trigger re-derivation. URL is updated via setSearchParams for shareability.
  const initialParseRef = useRef<{
    cg: string;
    inputs: FootprintQueryInput[];
  } | null>(null);

  if (initialParseRef.current === null) {
    let cg = searchParams.get("cg");
    if (!cg) {
      cg = crypto.randomUUID();
    }
    const encodedScenarios = searchParams.getAll("s");
    const decoded: FootprintQueryInput[] = encodedScenarios
      .map((e) => decodeScenario(e))
      .filter((d): d is ScenarioInput => d !== null)
      .map(scenarioInputToQuery);

    const inputs =
      decoded.length > 0 ? decoded : [buildDefaultScenario(null)];

    initialParseRef.current = { cg, inputs };
  }

  const { cg, inputs: initialInputs } = initialParseRef.current;

  // Persist cg back to URL if it was generated (replace-navigate to avoid
  // polluting history).
  useEffect(() => {
    if (searchParams.get("cg") === cg) return;
    const next = new URLSearchParams(searchParams);
    next.set("cg", cg);
    setSearchParams(next, { replace: true });
  }, [cg, searchParams, setSearchParams]);

  // --- Hook orchestrating N scenario fetches ---
  // Backend `productId` path param is the business SKU; wait for product load.
  const { scenarios, addScenario, updateScenario, removeScenario } =
    useFootprintComparison(product?.sku ?? "", cg, initialInputs);

  // --- URL sync: keep ?s= in sync with current scenarios so the page is shareable ---
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("s");
    for (const s of scenarios) {
      next.append("s", encodeScenario(queryToScenarioInput(s.input)));
    }
    next.set("cg", cg);
    const currentStr = searchParams.toString();
    const nextStr = next.toString();
    if (currentStr !== nextStr) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, cg]);

  // --- Best-of-N computation ---
  const bestIndex = useMemo(() => {
    let best = -1;
    let bestTotal = Number.POSITIVE_INFINITY;
    scenarios.forEach((s, i) => {
      if (s.data && s.data.total < bestTotal) {
        bestTotal = s.data.total;
        best = i;
      }
    });
    return best;
  }, [scenarios]);

  // --- Save comparison (clipboard) ---
  const [copiedVisible, setCopiedVisible] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);
  const onSaveComparison = useCallback(() => {
    // Build the shareable URL from origin + current pathname + live searchParams.
    // window.location.href would point at the host page URL in jsdom/dev embeds,
    // but searchParams reflects the router state (cg + s[]) we want to share.
    const shareUrl = `${window.location.origin}${window.location.pathname}?${searchParams.toString()}`;
    void navigator.clipboard.writeText(shareUrl);
    setCopiedVisible(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedVisible(false), 2000);
  }, [searchParams]);

  // --- Sequential CSV export of all scenarios ---
  const [exportStatus, setExportStatus] = useState<string>("");
  const onExportAll = useCallback(async () => {
    const exportable = scenarios.filter((s) => s.data !== null);
    const n = exportable.length;
    if (n === 0) return;
    for (let i = 0; i < n; i++) {
      setExportStatus(`Exporting ${i + 1} of ${n}…`);
      try {
        const correlationId = exportable[i].data!.correlationId;
        const blob = await getFootprintCsvExport(correlationId);
        downloadBlob(blob, `footprint-${correlationId}.csv`);
      } catch (err) {
        setExportStatus(`Stopped at ${i + 1}/${n}: ${extractProblemMessage(err)}`);
        return;
      }
    }
    setExportStatus(`Exported ${n} of ${n}.`);
  }, [scenarios]);

  // --- Per-card single CSV export ---
  const exportSingle = useCallback(async (correlationId: string) => {
    try {
      const blob = await getFootprintCsvExport(correlationId);
      downloadBlob(blob, `footprint-${correlationId}.csv`);
    } catch {
      // surfaced via per-scenario error UI in a future iteration
    }
  }, []);

  // --- Add scenario clones baseline inputs ---
  const onAddScenario = useCallback(() => {
    if (scenarios.length >= MAX_SCENARIOS) return;
    const baseline = scenarios[0]?.input ?? buildDefaultScenario(product);
    addScenario({ ...baseline });
  }, [scenarios, addScenario, product]);

  const onBackToDetail = useCallback(() => {
    if (id) navigate(`/products/${id}/footprint`);
  }, [id, navigate]);

  // --- Delta table: union of leaf component ids across scenarios ---
  const scenariosWithData = scenarios.filter((s) => s.data !== null);
  const allComponents = useMemo(() => {
    const set = new Set<string>();
    for (const s of scenariosWithData) {
      for (const k of Object.keys(leafTotalsFor(s))) set.add(k);
    }
    return Array.from(set);
  }, [scenariosWithData]);

  const baselineTotals = useMemo(
    () => (scenariosWithData[0] ? leafTotalsFor(scenariosWithData[0]) : {}),
    [scenariosWithData],
  );

  return (
    <Box>
      {/* Topbar / breadcrumb + actions */}
      <Flex
        as="header"
        justify="space-between"
        align="center"
        px="24px"
        py="14px"
        bg="white"
        borderBottom="1px solid"
        borderColor="gray.200"
      >
        <Flex as="nav" aria-label="Breadcrumb" fontSize="13px" gap="6px" align="center">
          <Link
            to="/products"
            style={{ color: "var(--chakra-colors-brand-600)", textDecoration: "none" }}
          >
            Products
          </Link>
          <Text as="span" color="gray.500">
            ›
          </Text>
          <Text as="span" fontWeight="600">
            {product?.sku ?? id}
          </Text>
          <Text as="span" color="gray.500">
            ›
          </Text>
          <Text as="span" fontWeight="600">
            Compare
          </Text>
        </Flex>
        <Flex gap="8px" align="center">
          <Button variant="outline" size="sm" onClick={onBackToDetail}>
            Back to detail
          </Button>
          <Button colorPalette="brand" size="sm" onClick={onSaveComparison}>
            Save comparison
          </Button>
          {copiedVisible ? (
            <Text fontSize="13px" color="green.600" role="status" aria-live="polite">
              Copied!
            </Text>
          ) : null}
        </Flex>
      </Flex>

      <Box maxW="1400px" mx="auto" p="24px">
        {/* Header */}
        <Heading as="h1" fontSize="22px" mb="4px">
          Compare scenarios — {product?.sku ?? id}
        </Heading>
        <Flex gap="24px" fontSize="12px" color="gray.600" mb="16px" wrap="wrap">
          <Text as="span">
            Comparison group:{" "}
            <Text
              as="code"
              fontFamily="mono"
              bg="gray.100"
              px="6px"
              py="1px"
              borderRadius="3px"
              fontSize="11px"
            >
              {cg}
            </Text>
          </Text>
          <Text as="span" color="green.600">
            {scenarios.length} audit rows linked via X-Comparison-Group header
          </Text>
        </Flex>

        <Flex gap="12px" mb="16px" align="center">
          <Button
            type="button"
            onClick={onAddScenario}
            disabled={scenarios.length >= MAX_SCENARIOS}
            variant="outline"
            size="sm"
          >
            + Add scenario (up to {MAX_SCENARIOS})
          </Button>
          <Button
            type="button"
            onClick={() => void onExportAll()}
            variant="outline"
            size="sm"
          >
            Export all as CSV
          </Button>
          <Text role="status" aria-live="polite" fontSize="13px" color="gray.600">
            {exportStatus}
          </Text>
        </Flex>

        {/* Scenario card grid */}
        <Grid
          gap="16px"
          mb="24px"
          templateColumns={{
            base: "1fr",
            md: "repeat(2, 1fr)",
            lg: "repeat(3, 1fr)",
          }}
        >
          {scenarios.map((scenario, index) => {
            const isBest = index === bestIndex && scenario.data !== null;
            const isOnlyOne = scenarios.length === 1;
            const baselineTotal = scenarios[0]?.data?.total ?? null;
            const pctVsA =
              index > 0 && scenario.data && baselineTotal !== null
                ? deltaPct(scenario.data.total, baselineTotal)
                : null;
            const totals = leafTotalsFor(scenario);
            const bars = miniBarRows(totals);
            const barTotal = bars.reduce((acc, b) => acc + b.kgCo2, 0);

            return (
              <Box
                key={scenario.id}
                data-testid="scenario-card"
                {...(isBest ? { "data-testid-best": "true" } : {})}
                bg="white"
                border="1px solid"
                borderColor="gray.200"
                borderRadius="8px"
                p="16px"
                display="flex"
                flexDirection="column"
                gap="12px"
              >
                {/* Card header */}
                <Flex justify="space-between" align="start">
                  <Heading as="h3" fontSize="14px" m="0">
                    {scenarioTitle(index, scenario.input)}
                  </Heading>
                  <Button
                    type="button"
                    aria-label="Remove scenario"
                    onClick={() => removeScenario(scenario.id)}
                    disabled={isOnlyOne}
                    size="xs"
                    variant="ghost"
                  >
                    ✕
                  </Button>
                </Flex>

                {/* Control form */}
                <Flex direction="column" gap="8px" pb="12px" borderBottom="1px solid" borderColor="gray.100">
                  <Flex as="label" justify="space-between" align="center" fontSize="12px" color="gray.600">
                    <Text as="span">Date</Text>
                    <input
                      type="date"
                      value={scenario.input.asOf ?? ""}
                      onChange={(e) =>
                        updateScenario(scenario.id, {
                          ...scenario.input,
                          asOf: e.target.value,
                        })
                      }
                      style={{
                        padding: "4px 8px",
                        border: "1px solid var(--chakra-colors-gray-300)",
                        borderRadius: 4,
                        fontSize: 12,
                        width: 160,
                      }}
                    />
                  </Flex>
                  <Flex as="label" justify="space-between" align="center" fontSize="12px" color="gray.600">
                    <Text as="span">Destination km</Text>
                    <input
                      type="number"
                      min={0}
                      value={scenario.input.destinationDistanceKm ?? ""}
                      onChange={(e) =>
                        updateScenario(scenario.id, {
                          ...scenario.input,
                          destinationDistanceKm:
                            e.target.value === "" ? undefined : Number(e.target.value),
                        })
                      }
                      style={{
                        padding: "4px 8px",
                        border: "1px solid var(--chakra-colors-gray-300)",
                        borderRadius: 4,
                        fontSize: 12,
                        width: 160,
                      }}
                    />
                  </Flex>
                  <Flex as="label" justify="space-between" align="center" fontSize="12px" color="gray.600">
                    <Text as="span">Storage days</Text>
                    <input
                      type="number"
                      min={0}
                      value={scenario.input.storageDays ?? 0}
                      onChange={(e) =>
                        updateScenario(scenario.id, {
                          ...scenario.input,
                          storageDays:
                            e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                      style={{
                        padding: "4px 8px",
                        border: "1px solid var(--chakra-colors-gray-300)",
                        borderRadius: 4,
                        fontSize: 12,
                        width: 160,
                      }}
                    />
                  </Flex>
                </Flex>

                {/* Total */}
                {scenario.loading ? (
                  <Box p="12px" textAlign="center" color="gray.500" role="status" aria-live="polite">
                    Loading…
                  </Box>
                ) : scenario.error ? (
                  <Box
                    p="12px"
                    bg="red.50"
                    border="1px solid"
                    borderColor="red.200"
                    borderRadius="6px"
                    color="red.700"
                    fontSize="13px"
                  >
                    {scenario.error}
                  </Box>
                ) : scenario.data ? (
                  <Box
                    {...(isBest ? { "data-testid": "scenario-card-best" } : {})}
                    p="12px"
                    bg={isBest ? "green.50" : "gray.50"}
                    border={isBest ? "1px solid" : undefined}
                    borderColor={isBest ? "green.200" : undefined}
                    borderRadius="6px"
                    textAlign="center"
                  >
                    <Text as="span" fontSize="32px" fontWeight="600" color={isBest ? "green.800" : "gray.800"}>
                      {scenario.data.total.toFixed(2)}
                    </Text>
                    <Text as="span" fontSize="13px" color="gray.600" ml="6px">
                      kg CO₂
                    </Text>
                    {pctVsA !== null ? (
                      <Text
                        display="block"
                        mt="4px"
                        fontSize="12px"
                        fontWeight="500"
                        color={pctVsA < 0 ? "green.700" : "red.600"}
                      >
                        {pctVsA < 0 ? "−" : "+"}
                        {Math.abs(pctVsA).toFixed(0)}% vs A
                      </Text>
                    ) : null}
                  </Box>
                ) : null}

                {/* Mini-bars */}
                {scenario.data ? (
                  <Flex direction="column" gap="6px" fontSize="12px">
                    {bars.map((bar) => {
                      const pct =
                        barTotal > 0 ? Math.min(100, (bar.kgCo2 / barTotal) * 100) : 0;
                      return (
                        <Grid
                          key={bar.label}
                          templateColumns="90px 1fr 40px"
                          alignItems="center"
                          gap="8px"
                        >
                          <Text>{bar.label}</Text>
                          <Box bg="gray.100" borderRadius="3px" height="10px">
                            <Box
                              bg="brand.500"
                              height="10px"
                              borderRadius="3px"
                              style={{ width: `${pct}%` }}
                            />
                          </Box>
                          <Text fontFamily="mono" textAlign="right" fontWeight="500">
                            {bar.kgCo2.toFixed(2)}
                          </Text>
                        </Grid>
                      );
                    })}
                  </Flex>
                ) : null}

                {/* Per-card CSV export */}
                {scenario.data ? (
                  <Button
                    type="button"
                    onClick={() => void exportSingle(scenario.data!.correlationId)}
                    variant="ghost"
                    size="xs"
                    alignSelf="flex-start"
                  >
                    Export CSV
                  </Button>
                ) : null}
              </Box>
            );
          })}
        </Grid>

        {/* Delta table */}
        {scenariosWithData.length > 0 ? (
          <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p="20px">
            <Heading as="h3" fontSize="15px" mb="12px">
              Component deltas vs Scenario A
            </Heading>
            <Table.Root size="sm" variant="line">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Component</Table.ColumnHeader>
                  {scenariosWithData.map((_, i) => (
                    <Table.ColumnHeader key={`hdr-val-${i}`} textAlign="right">
                      {SCENARIO_LETTERS[i] ?? String(i + 1)}
                    </Table.ColumnHeader>
                  ))}
                  {scenariosWithData.slice(1).map((_, i) => (
                    <Table.ColumnHeader key={`hdr-delta-${i}`} textAlign="right">
                      Δ {SCENARIO_LETTERS[i + 1] ?? String(i + 2)}
                    </Table.ColumnHeader>
                  ))}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {allComponents.map((component) => {
                  const baseValue = baselineTotals[component] ?? 0;
                  return (
                    <Table.Row key={component}>
                      <Table.Cell>{component}</Table.Cell>
                      {scenariosWithData.map((s, i) => (
                        <Table.Cell key={`val-${component}-${i}`} fontFamily="mono" textAlign="right">
                          {(leafTotalsFor(s)[component] ?? 0).toFixed(2)}
                        </Table.Cell>
                      ))}
                      {scenariosWithData.slice(1).map((s, i) => {
                        const value = leafTotalsFor(s)[component] ?? 0;
                        const delta = value - baseValue;
                        const color =
                          Math.abs(delta) < 0.005
                            ? "gray.500"
                            : delta < 0
                              ? "green.700"
                              : "red.600";
                        const text =
                          Math.abs(delta) < 0.005
                            ? "—"
                            : `${delta < 0 ? "−" : "+"}${Math.abs(delta).toFixed(2)}`;
                        return (
                          <Table.Cell
                            key={`delta-${component}-${i}`}
                            fontFamily="mono"
                            textAlign="right"
                            color={color}
                          >
                            {text}
                          </Table.Cell>
                        );
                      })}
                    </Table.Row>
                  );
                })}
                {/* Total row */}
                <Table.Row borderTopWidth="2px" borderTopColor="gray.300">
                  <Table.Cell fontWeight="600">Total</Table.Cell>
                  {scenariosWithData.map((s, i) => (
                    <Table.Cell key={`total-${i}`} fontFamily="mono" textAlign="right" fontWeight="600">
                      {formatCO2eKg(s.data!.total).replace(" kg CO₂", "")}
                    </Table.Cell>
                  ))}
                  {scenariosWithData.slice(1).map((s, i) => {
                    const baseTotal = scenariosWithData[0].data!.total;
                    const delta = s.data!.total - baseTotal;
                    const color =
                      Math.abs(delta) < 0.005
                        ? "gray.500"
                        : delta < 0
                          ? "green.700"
                          : "red.600";
                    const text =
                      Math.abs(delta) < 0.005
                        ? "—"
                        : `${delta < 0 ? "−" : "+"}${Math.abs(delta).toFixed(2)}`;
                    return (
                      <Table.Cell
                        key={`total-delta-${i}`}
                        fontFamily="mono"
                        textAlign="right"
                        fontWeight="600"
                        color={color}
                      >
                        {text}
                      </Table.Cell>
                    );
                  })}
                </Table.Row>
              </Table.Body>
            </Table.Root>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
