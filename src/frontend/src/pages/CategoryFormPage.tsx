import { Box, Button, Flex, Grid, Heading, Input, Text, Textarea } from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getCategory, createCategory, updateCategory } from "../api/categories";
import { extractProblemMessage } from "../api/problem";
import { PrimaryButton } from "../components/shared/PrimaryButton";

const labelStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#334155",
  display: "block",
  marginBottom: "6px",
};

/**
 * Structural port of `ProductFormPage.tsx`, reduced to the 2 category
 * fields (`name`, `description`) in a single-column `Grid` per
 * `ui-mockups.md` Mockup 4. Shared between `/categories/new` and
 * `/categories/:id/edit`.
 */
export function CategoryFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      if (id) {
        const category = await getCategory(Number(id));
        setName(category.name);
        setDescription(category.description ?? "");
      }
    } catch (err) {
      setError(extractProblemMessage(err));
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
      description: description || undefined,
    };
    try {
      if (isEdit && id) {
        await updateCategory(Number(id), payload);
      } else {
        await createCategory(payload);
      }
      navigate("/categories");
    } catch (err) {
      // Explicit fix of the generic-catch anti-pattern in
      // ProductFormPage.tsx — surface the backend's actual message
      // (e.g. a name-conflict validation error) instead of a fallback.
      setError(extractProblemMessage(err));
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
          <Link to="/categories" style={{ color: "var(--chakra-colors-brand-600)", textDecoration: "none" }}>
            Categories
          </Link>
          <Text as="span">/</Text>
          <Text as="span">{isEdit ? "Edit Category" : "Add New Category"}</Text>
        </Flex>
        <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A" mt="4px">
          {isEdit ? "Edit Category" : "Add New Category"}
        </Heading>
      </Box>

      <Box as="form" onSubmit={handleSubmit} bg="white" border="1px solid" borderColor="#E2E8F0" borderRadius="12px" p="32px">
        <Grid templateColumns="1fr" gap="20px">
          <Box>
            <label htmlFor="category-name" style={labelStyle}>
              Name <Text as="span" color="#EF4444">*</Text>
            </label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Zabawka"
              required
            />
          </Box>

          <Box>
            <label htmlFor="category-description" style={labelStyle}>
              Description
            </label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this category..."
              rows={4}
            />
          </Box>
        </Grid>

        {error && (
          <Box mt="16px" p="12px" bg="#FEE2E2" borderRadius="8px" fontSize="13px" color="#991B1B" aria-live="polite">
            {error}
          </Box>
        )}

        <Flex justify="flex-end" gap="12px" mt="28px" pt="20px" borderTop="1px solid" borderColor="#F1F5F9">
          <Button asChild variant="outline">
            <Link to="/categories">Cancel</Link>
          </Button>
          <PrimaryButton type="submit" loading={loading}>
            Save Category
          </PrimaryButton>
        </Flex>
      </Box>
    </Box>
  );
}
