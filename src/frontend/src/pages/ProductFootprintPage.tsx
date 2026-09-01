import { Box, Button, Flex, Grid, GridItem, Heading, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getProduct } from "../api/products";
import type { ProductResponse } from "../api/products";
import { useProductFootprint } from "../hooks/useProductFootprint";
import type { CompositeDto, FootprintQueryInput, Normalisation } from "../api/footprints";
import { BreakdownTree } from "../components/footprint/BreakdownTree";
import { ScopeBar } from "../components/footprint/ScopeBar";
import { CsvExportButton } from "../components/footprint/CsvExportButton";
import type { ScopeValue } from "../components/footprint/ScopeChip";
import { formatCO2eKg, formatPer100g } from "../utils/format";

interface ContextBarState {
  date: string;
  materialWeightKg: string;
  supplierDistanceKm: string;
  destinationKm: string;
  storageDays: string;
  unit: Normalisation;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function deriveTopLevelScope(node: CompositeDto): ScopeValue {
  const scopes = new Set<number>();
  function visit(n: CompositeDto | typeof node.children[number]): void {
    if (n.type === "leaf") {
      scopes.add(n.scope);
      return;
    }
    for (const child of n.children) visit(child);
  }
  visit(node);
  if (scopes.size === 0) return "mixed";
  if (scopes.size === 1) {
    const only = [...scopes][0] as 1 | 2 | 3;
    return only;
  }
  return "mixed";
}

function formatTotal(value: number, unit: string): { big: string; suffix: string } {
  const fullText = unit === "KG_CO2_PER_100G" ? formatPer100g(value) : formatCO2eKg(value);
  // Split numeric prefix from suffix for display ("5.370 kg CO₂")
  const match = fullText.match(/^(\S+)\s+(.+)$/);
  if (!match) return { big: fullText, suffix: "" };
  return { big: match[1], suffix: match[2] };
}

export function ProductFootprintPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [product, setProduct] = useState<ProductResponse | null>(null);
  const [productLoading, setProductLoading] = useState(true);
  const [productError, setProductError] = useState<string | null>(null);

  // Pending = what user has typed; applied = what's been sent to the hook.
  const [pending, setPending] = useState<ContextBarState>({
    date: todayIso(),
    materialWeightKg: "",
    supplierDistanceKm: "",
    destinationKm: "",
    storageDays: "0",
    unit: "TOTAL",
  });
  const [applied, setApplied] = useState<ContextBarState>(pending);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setProductLoading(true);
    setProductError(null);
    getProduct(Number(id))
      .then((p) => {
        if (!cancelled) setProduct(p);
      })
      .catch(() => {
        if (!cancelled) setProductError("Failed to load product.");
      })
      .finally(() => {
        if (!cancelled) setProductLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Memoise the query so the hook does not refetch on every keystroke; only on
  // explicit Recalculate (which updates `applied`).
  const query = useMemo<FootprintQueryInput>(() => {
    const q: FootprintQueryInput = {
      asOf: applied.date,
      storageDays: Number(applied.storageDays) || 0,
      unit: applied.unit,
    };
    const setIfNumber = (raw: string, key: keyof FootprintQueryInput): void => {
      if (raw === "") return;
      const n = Number(raw);
      if (!Number.isNaN(n)) (q[key] as number) = n;
    };
    setIfNumber(applied.materialWeightKg, "materialWeightKg");
    setIfNumber(applied.supplierDistanceKm, "supplierDistanceKm");
    setIfNumber(applied.destinationKm, "destinationDistanceKm");
    return q;
  }, [applied]);

  // Backend `productId` path param is the business SKU, not the DB sequence id.
  // Skip the footprint fetch until the product (and its SKU) have loaded.
  const { data, loading, error, refetch, correlationId } = useProductFootprint(
    product?.sku ?? "",
    query,
  );

  const onRecalculate = useCallback(() => {
    setApplied(pending);
  }, [pending]);

  const onCompare = useCallback(() => {
    if (id) navigate(`/products/${id}/footprint/compare`);
  }, [id, navigate]);

  if (loading || productLoading) {
    return (
      <Box p="24px" role="status" aria-live="polite">
        <Text>Loading footprint…</Text>
      </Box>
    );
  }

  return (
    <Box>
      {/* Topbar / breadcrumb */}
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
          <Link to="/products" style={{ color: "var(--chakra-colors-brand-600)", textDecoration: "none" }}>
            Products
          </Link>
          <Text as="span" color="gray.500">
            ›
          </Text>
          <Text as="span" fontWeight="600">
            {product?.sku ?? id}
          </Text>
        </Flex>
        <Button variant="outline" size="sm" onClick={onCompare}>
          Compare scenarios
        </Button>
      </Flex>

      <Grid
        gap="24px"
        p="24px"
        maxW="1400px"
        mx="auto"
        templateColumns={{ base: "1fr", md: "280px 1fr" }}
      >
        {/* Product card (left on desktop, above on mobile) */}
        <GridItem>
          <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p="20px">
            {product ? (
              <>
                <Heading as="h2" size="md" mb="4px">
                  {product.name}
                </Heading>
                <Text color="gray.600" fontSize="13px" mb="16px" fontFamily="mono">
                  SKU {product.sku}
                </Text>
                <Box as="dl" fontSize="13px">
                  <Text as="dt" color="gray.600" mt="8px">
                    Material weight
                  </Text>
                  <Text as="dd" m="0" fontWeight="500">
                    {data?.parametersEcho.materialWeightKg != null
                      ? `${data.parametersEcho.materialWeightKg} kg`
                      : "—"}
                  </Text>
                  <Text as="dt" color="gray.600" mt="8px">
                    Supplier distance
                  </Text>
                  <Text as="dd" m="0" fontWeight="500">
                    {data?.parametersEcho.supplierDistanceKm != null
                      ? `${data.parametersEcho.supplierDistanceKm} km`
                      : "—"}
                  </Text>
                  <Text as="dt" color="gray.600" mt="8px">
                    Refrigerated
                  </Text>
                  <Text as="dd" m="0" fontWeight="500">
                    {data?.parametersEcho.requiresRefrigeration ? "Yes" : "No"}
                  </Text>
                </Box>
              </>
            ) : productError ? (
              <Text color="red.600">{productError}</Text>
            ) : null}
          </Box>
        </GridItem>

        {/* Main pane */}
        <GridItem>
          <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p="24px">
            {/* Context bar */}
            <Flex
              as="form"
              wrap="wrap"
              gap="16px"
              align="end"
              pb="20px"
              borderBottom="1px solid"
              borderColor="gray.200"
              mb="20px"
              onSubmit={(e) => {
                e.preventDefault();
                onRecalculate();
              }}
            >
              <Box>
                <Text as="label" fontSize="11px" color="gray.600" textTransform="uppercase" letterSpacing="0.04em">
                  Date
                </Text>
                <input
                  type="date"
                  value={pending.date}
                  onChange={(e) => setPending((p) => ({ ...p, date: e.target.value }))}
                  style={{ display: "block", padding: "6px 10px", border: "1px solid var(--chakra-colors-gray-300)", borderRadius: 6, fontSize: 13 }}
                />
              </Box>
              <Box>
                <Text as="label" fontSize="11px" color="gray.600" textTransform="uppercase" letterSpacing="0.04em">
                  Material weight (kg)
                </Text>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={pending.materialWeightKg}
                  onChange={(e) => setPending((p) => ({ ...p, materialWeightKg: e.target.value }))}
                  style={{ display: "block", padding: "6px 10px", border: "1px solid var(--chakra-colors-gray-300)", borderRadius: 6, fontSize: 13 }}
                />
              </Box>
              <Box>
                <Text as="label" fontSize="11px" color="gray.600" textTransform="uppercase" letterSpacing="0.04em">
                  Supplier dist. (km)
                </Text>
                <input
                  type="number"
                  min={0}
                  value={pending.supplierDistanceKm}
                  onChange={(e) => setPending((p) => ({ ...p, supplierDistanceKm: e.target.value }))}
                  style={{ display: "block", padding: "6px 10px", border: "1px solid var(--chakra-colors-gray-300)", borderRadius: 6, fontSize: 13 }}
                />
              </Box>
              <Box>
                <Text as="label" fontSize="11px" color="gray.600" textTransform="uppercase" letterSpacing="0.04em">
                  Destination (km)
                </Text>
                <input
                  type="number"
                  min={0}
                  value={pending.destinationKm}
                  onChange={(e) => setPending((p) => ({ ...p, destinationKm: e.target.value }))}
                  style={{ display: "block", padding: "6px 10px", border: "1px solid var(--chakra-colors-gray-300)", borderRadius: 6, fontSize: 13 }}
                />
              </Box>
              <Box>
                <Text as="label" fontSize="11px" color="gray.600" textTransform="uppercase" letterSpacing="0.04em">
                  Storage days
                </Text>
                <input
                  type="number"
                  min={0}
                  value={pending.storageDays}
                  onChange={(e) => setPending((p) => ({ ...p, storageDays: e.target.value }))}
                  style={{ display: "block", padding: "6px 10px", border: "1px solid var(--chakra-colors-gray-300)", borderRadius: 6, fontSize: 13 }}
                />
              </Box>
              <Box>
                <Text as="label" fontSize="11px" color="gray.600" textTransform="uppercase" letterSpacing="0.04em">
                  Unit
                </Text>
                <select
                  value={pending.unit}
                  onChange={(e) => setPending((p) => ({ ...p, unit: e.target.value as Normalisation }))}
                  style={{ display: "block", padding: "6px 10px", border: "1px solid var(--chakra-colors-gray-300)", borderRadius: 6, fontSize: 13 }}
                >
                  <option value="TOTAL">Per product</option>
                  <option value="PER_100G">Per 100g</option>
                </select>
              </Box>
              <Button type="submit" colorPalette="brand" size="sm">
                Recalculate
              </Button>
            </Flex>

            {error ? (
              <Box bg="red.50" border="1px solid" borderColor="red.200" borderRadius="6px" p="16px" mb="16px">
                <Text color="red.700" mb="8px">
                  {error}
                </Text>
                <Button size="sm" variant="outline" onClick={() => void refetch()}>
                  Retry
                </Button>
              </Box>
            ) : null}

            {data ? (
              <>
                {/* Summary card */}
                <Flex
                  justify="space-between"
                  align="baseline"
                  bg="green.50"
                  border="1px solid"
                  borderColor="green.200"
                  borderRadius="8px"
                  p="20px"
                  mb="24px"
                >
                  <Box>
                    <Text as="span" fontSize="48px" fontWeight="600" color="green.800">
                      {formatTotal(data.total, data.unit).big}
                    </Text>
                    <Text as="span" ml="8px" fontSize="18px" color="green.700">
                      {formatTotal(data.total, data.unit).suffix}
                    </Text>
                    <Box mt="8px">
                      <Text
                        as="span"
                        display="inline-block"
                        px="8px"
                        py="2px"
                        borderRadius="10px"
                        fontSize="11px"
                        fontWeight="500"
                        bg={data.options.strictness === "STRICT" ? "blue.100" : "yellow.100"}
                        color={data.options.strictness === "STRICT" ? "blue.800" : "yellow.800"}
                      >
                        {data.options.strictness === "STRICT" ? "Strict" : "Lenient"}
                      </Text>
                    </Box>
                  </Box>
                  <Box textAlign="right" fontSize="12px" color="green.700" lineHeight="1.6">
                    <Text>Calculated {data.computedAt}</Text>
                    <Text fontFamily="mono" color="green.800">
                      correlationId: {data.correlationId}
                    </Text>
                  </Box>
                </Flex>

                {/* Top-level bars */}
                <Box mb="24px">
                  {data.breakdown.type === "composite"
                    ? data.breakdown.children.map((child) => (
                        <ScopeBar
                          key={child.componentId}
                          label={child.componentId}
                          kgCo2={child.kgCo2}
                          total={data.total}
                          scope={
                            child.type === "composite"
                              ? deriveTopLevelScope(child)
                              : (child.scope as ScopeValue)
                          }
                        />
                      ))
                    : null}
                </Box>

                {/* Breakdown table */}
                <Heading as="h3" fontSize="15px" mb="12px">
                  Breakdown
                </Heading>
                <BreakdownTree root={data.breakdown} total={data.total} />

                {/* CSV export */}
                <Box mt="20px">
                  {correlationId ? <CsvExportButton correlationId={correlationId} /> : null}
                </Box>
              </>
            ) : null}
          </Box>
        </GridItem>
      </Grid>
    </Box>
  );
}
