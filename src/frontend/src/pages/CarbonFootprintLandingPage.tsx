import { Box, Flex, Heading, Input, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getProducts } from "../api/products";
import type { ProductResponse } from "../api/products";
import { EmptyState } from "../components/shared/EmptyState";
import { FootprintIcon } from "../components/shared/Icons";

export function CarbonFootprintLandingPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ProductResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  useEffect(() => {
    if (!search) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProducts({ search })
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load products.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search]);

  return (
    <Box>
      <Box mb="24px">
        <Heading as="h1" fontSize="24px" fontWeight="700" color="gray.900">
          Carbon Footprint
        </Heading>
        <Text fontSize="14px" color="gray.500" mt="4px">
          Search a product to view its carbon footprint breakdown.
        </Text>
      </Box>

      <Box mb="24px" maxW="480px">
        <Input
          placeholder="Search products..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Search products"
        />
      </Box>

      {!search && (
        <EmptyState
          icon={<FootprintIcon size={48} />}
          title="Search a product to see its footprint."
        />
      )}

      {search && loading && <Text color="gray.500">Loading...</Text>}

      {search && error && <Text color="red.500">{error}</Text>}

      {search && !loading && !error && results.length === 0 && (
        <EmptyState title="No products found." />
      )}

      {search && !loading && !error && results.length > 0 && (
        <Flex direction="column" gap="8px">
          {results.map((product) => (
            <Box
              key={product.id}
              bg="white"
              border="1px solid"
              borderColor="gray.200"
              borderRadius="8px"
              _hover={{ borderColor: "brand.400", bg: "gray.50" }}
            >
              <Link
                to={`/products/${product.id}/footprint`}
                style={{
                  display: "block",
                  padding: "12px 16px",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <Flex align="center" gap="12px">
                  <FootprintIcon size={18} />
                  <Box flex="1">
                    <Text fontSize="14px" fontWeight="600" color="gray.900">
                      {product.name}
                    </Text>
                    <Text fontSize="12px" color="gray.500" fontFamily="monospace">
                      {product.sku} · {product.category.name}
                    </Text>
                  </Box>
                </Flex>
              </Link>
            </Box>
          ))}
        </Flex>
      )}
    </Box>
  );
}
