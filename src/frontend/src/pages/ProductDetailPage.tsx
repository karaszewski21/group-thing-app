import {
  Box,
  Button,
  Flex,
  Heading,
  Image,
  Text,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getProduct } from "../api/products";
import type { ProductResponse } from "../api/products";
import { usePluginContext } from "../plugins/PluginContext";
import { PRODUCT_DETAIL_INFO, PRODUCT_DETAIL_TABS } from "../plugins/extensionPoints";
import { PluginFrame } from "../plugins/PluginFrame";
import { FootprintIcon, PhotoPlaceholder } from "../components/shared/Icons";
import { formatPrice } from "../utils/format";
import { isValidImageUrl } from "../utils/url";

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const { getProductDetailTabs, getProductDetailInfo } = usePluginContext();

  const loadProduct = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getProduct(Number(id));
      setProduct(data);
    } catch {
      setError("Failed to load product.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  if (loading) return <Text>Loading...</Text>;
  if (error) return <Text color="red.500">{error}</Text>;
  if (!product) return <Text>Product not found.</Text>;

  const pluginTabs = getProductDetailTabs();

  const tabs = [
    { label: "Details", key: "details" },
    ...pluginTabs.map((tab) => ({
      label: tab.label ?? tab.pluginName,
      key: `${tab.pluginId}-${tab.path}`,
      pluginId: tab.pluginId,
      pluginName: tab.pluginName,
      pluginUrl: tab.pluginUrl,
      path: tab.path,
    })),
  ];

  return (
    <Box>
      <Box mb="24px">
        <Flex as="nav" fontSize="13px" color="#64748B" gap="4px" aria-label="Breadcrumb">
          <Link to="/products" style={{ color: "var(--chakra-colors-brand-600)", textDecoration: "none" }}>
            Products
          </Link>
          <Text as="span">/</Text>
          <Text as="span">{product.name}</Text>
        </Flex>
        <Flex mt="4px" align="center" justify="space-between" gap="12px" wrap="wrap">
          <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A">
            {product.name}
          </Heading>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/products/${product.id}/footprint`)}
            aria-label="View carbon footprint"
          >
            <FootprintIcon size={16} />
            View carbon footprint
          </Button>
        </Flex>
      </Box>

      <Flex
        as="div"
        role="tablist"
        gap="0"
        borderBottom="2px solid"
        borderColor="#E2E8F0"
        mb="24px"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === index}
            onClick={() => setActiveTab(index)}
            style={{
              padding: "10px 20px",
              fontSize: "14px",
              fontWeight: 600,
              color: activeTab === index ? "#0D9488" : "#64748B",
              background: "none",
              border: "none",
              borderBottom: activeTab === index ? "2px solid #0D9488" : "2px solid transparent",
              marginBottom: "-2px",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </Flex>

      {/* Details tab panel */}
      <Box display={activeTab === 0 ? "block" : "none"} role="tabpanel">
        <Box bg="white" border="1px solid" borderColor="#E2E8F0" borderRadius="12px" p="32px">
          <Flex gap="32px" direction={{ base: "column", md: "row" }}>
            <Box
              w={{ base: "100%", md: "200px" }}
              h="200px"
              borderRadius="12px"
              overflow="hidden"
              bg="#F1F5F9"
              display="flex"
              alignItems="center"
              justifyContent="center"
              flexShrink={0}
            >
              {isValidImageUrl(product.photoUrl) ? (
                <Image
                  src={product.photoUrl!}
                  alt={product.name}
                  w="100%"
                  h="100%"
                  objectFit="cover"
                />
              ) : (
                <PhotoPlaceholder size={64} />
              )}
            </Box>
            <Box flex="1">
              <Flex direction="column" gap="12px">
                <Box>
                  <Text fontSize="12px" fontWeight="600" color="#64748B" textTransform="uppercase">
                    Price
                  </Text>
                  <Text fontSize="20px" fontWeight="700" color="brand.700">
                    {formatPrice(product.price)}
                  </Text>
                </Box>
                <Box>
                  <Text fontSize="12px" fontWeight="600" color="#64748B" textTransform="uppercase">
                    SKU
                  </Text>
                  <Text fontFamily="monospace" color="#334155">
                    {product.sku}
                  </Text>
                </Box>
                <Box>
                  <Text fontSize="12px" fontWeight="600" color="#64748B" textTransform="uppercase">
                    Category
                  </Text>
                  <Text color="#334155">{product.category.name}</Text>
                </Box>
                {product.description && (
                  <Box>
                    <Text fontSize="12px" fontWeight="600" color="#64748B" textTransform="uppercase">
                      Description
                    </Text>
                    <Text color="#334155">{product.description}</Text>
                  </Box>
                )}
              </Flex>
            </Box>
          </Flex>
        </Box>
        {getProductDetailInfo().map((info) => (
          <Box key={`${info.pluginId}-${info.path}`} mt="16px" h="60px">
            <PluginFrame
              pluginId={info.pluginId}
              pluginName={info.pluginName}
              pluginUrl={info.pluginUrl}
              contextType={PRODUCT_DETAIL_INFO}
              contextData={{ productId: product.id }}
              path={info.path!}
              style={{ height: "60px" }}
            />
          </Box>
        ))}
      </Box>

      {/* Plugin tab panels - render all, show/hide with CSS to preserve iframe state */}
      {pluginTabs.map((tab, index) => (
        <Box
          key={`${tab.pluginId}-${tab.path}`}
          display={activeTab === index + 1 ? "block" : "none"}
          role="tabpanel"
          h="600px"
        >
          <PluginFrame
            pluginId={tab.pluginId}
            pluginName={tab.pluginName}
            pluginUrl={tab.pluginUrl}
            contextType={PRODUCT_DETAIL_TABS}
            contextData={{ productId: product.id }}
            path={tab.path!}
          />
        </Box>
      ))}
    </Box>
  );
}
