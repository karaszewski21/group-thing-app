import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Input,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getProduct, createProduct, updateProduct } from "../api/products";
import { getCategories } from "../api/categories";
import type { CategoryResponse } from "../api/categories";
import { PhotoPlaceholder } from "../components/shared/Icons";
import { isValidImageUrl } from "../utils/url";
import { PrimaryButton } from "../components/shared/PrimaryButton";

const labelStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#334155",
  display: "block",
  marginBottom: "6px",
};

export function ProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const cats = await getCategories();
      setCategories(cats);
      if (id) {
        const product = await getProduct(Number(id));
        setName(product.name);
        setSku(product.sku);
        setPrice(String(product.price));
        setCategoryId(String(product.category.id));
        setDescription(product.description ?? "");
        setPhotoUrl(product.photoUrl ?? "");
      }
    } catch {
      setError("Failed to load data.");
    } finally {
      setLoadingData(false);
    }
  }, [id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const payload = {
      name,
      sku,
      price: parseFloat(price),
      categoryId: parseInt(categoryId, 10),
      description: description || undefined,
      photoUrl: photoUrl || undefined,
    };
    try {
      if (isEdit && id) {
        await updateProduct(Number(id), payload);
      } else {
        await createProduct(payload);
      }
      navigate("/products");
    } catch {
      setError("Failed to save product.");
    } finally {
      setLoading(false);
    }
  }

  if (loadingData) {
    return <Text>Loading...</Text>;
  }

  return (
    <Box maxW="800px">
      <Box mb="24px">
        <Flex as="nav" fontSize="13px" color="#64748B" gap="4px" aria-label="Breadcrumb">
          <Link to="/products" style={{ color: "var(--chakra-colors-brand-600)", textDecoration: "none" }}>
            Products
          </Link>
          <Text as="span">/</Text>
          <Text as="span">{isEdit ? "Edit Product" : "Add New Product"}</Text>
        </Flex>
        <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A" mt="4px">
          {isEdit ? "Edit Product" : "Add New Product"}
        </Heading>
      </Box>

      <Box as="form" onSubmit={handleSubmit} bg="white" border="1px solid" borderColor="#E2E8F0" borderRadius="12px" p="32px">
        <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="20px">
          <Box>
            <label htmlFor="product-name" style={labelStyle}>
              Product Name <Text as="span" color="#EF4444">*</Text>
            </label>
            <Input
              id="product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Wireless Headphones Pro"
              required
            />
          </Box>

          <Box>
            <label htmlFor="product-sku" style={labelStyle}>
              SKU <Text as="span" color="#EF4444">*</Text>
            </label>
            <Input
              id="product-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="e.g. WHP-001"
              required
            />
            <Text fontSize="12px" color="#94A3B8" mt="6px">
              Unique stock keeping unit identifier
            </Text>
          </Box>

          <Box>
            <label htmlFor="product-price" style={labelStyle}>
              Price <Text as="span" color="#EF4444">*</Text>
            </label>
            <Input
              id="product-price"
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              required
            />
          </Box>

          <Box>
            <label htmlFor="product-category" style={labelStyle}>
              Category <Text as="span" color="#EF4444">*</Text>
            </label>
            <select
              id="product-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #E2E8F0",
                borderRadius: "8px",
                fontSize: "14px",
                background: "white",
              }}
            >
              <option value="">Select a category...</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </Box>

          <Box gridColumn={{ base: "1", md: "1 / -1" }}>
            <label htmlFor="product-description" style={labelStyle}>
              Description
            </label>
            <Textarea
              id="product-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your product..."
              rows={4}
            />
          </Box>

          <Box gridColumn={{ base: "1", md: "1 / -1" }}>
            <label htmlFor="product-photo-url" style={labelStyle}>
              Photo URL
            </label>
            <Input
              id="product-photo-url"
              type="url"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
            />
            <Text fontSize="12px" color="#94A3B8" mt="6px">
              External URL to product image
            </Text>
            <Box mt="8px">
              {isValidImageUrl(photoUrl) ? (
                <Box
                  w="120px"
                  h="120px"
                  borderRadius="12px"
                  overflow="hidden"
                  border="1px solid"
                  borderColor="#E2E8F0"
                >
                  <img src={photoUrl} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </Box>
              ) : (
                <Flex
                  w="120px"
                  h="120px"
                  border="2px dashed"
                  borderColor="#E2E8F0"
                  borderRadius="12px"
                  align="center"
                  justify="center"
                  direction="column"
                  gap="8px"
                  color="#94A3B8"
                  fontSize="11px"
                  textAlign="center"
                  p="8px"
                >
                  <PhotoPlaceholder size={32} />
                  <span>Image preview</span>
                </Flex>
              )}
            </Box>
          </Box>
        </Grid>

        {error && (
          <Box mt="16px" p="12px" bg="#FEE2E2" borderRadius="8px" fontSize="13px" color="#991B1B">
            {error}
          </Box>
        )}

        <Flex justify="flex-end" gap="12px" mt="28px" pt="20px" borderTop="1px solid" borderColor="#F1F5F9">
          <Button asChild variant="outline">
            <Link to="/products">Cancel</Link>
          </Button>
          <PrimaryButton type="submit" loading={loading}>
            Save Product
          </PrimaryButton>
        </Flex>
      </Box>
    </Box>
  );
}
