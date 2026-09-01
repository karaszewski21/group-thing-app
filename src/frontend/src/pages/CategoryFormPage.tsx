import {
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getCategory, createCategory, updateCategory } from "../api/categories";
import { PrimaryButton } from "../components/shared/PrimaryButton";

export function CategoryFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  const loadCategory = useCallback(async () => {
    if (!id) return;
    setLoadingData(true);
    try {
      const category = await getCategory(Number(id));
      setName(category.name);
      setDescription(category.description ?? "");
    } catch {
      setError("Failed to load category.");
    } finally {
      setLoadingData(false);
    }
  }, [id]);

  useEffect(() => {
    void loadCategory();
  }, [loadCategory]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isEdit && id) {
        await updateCategory(Number(id), { name, description: description || undefined });
      } else {
        await createCategory({ name, description: description || undefined });
      }
      navigate("/categories");
    } catch (err) {
      if (err instanceof Error && err.message.includes("409")) {
        setError("A category with this name already exists.");
      } else {
        setError("Failed to save category.");
      }
    } finally {
      setLoading(false);
    }
  }

  if (loadingData) {
    return <Text>Loading...</Text>;
  }

  return (
    <Box maxW="600px">
      <Box mb="24px">
        <Flex as="nav" fontSize="13px" color="#64748B" gap="4px" aria-label="Breadcrumb">
          <Link to="/categories" style={{ color: "#0D9488", textDecoration: "none" }}>
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
        <Flex direction="column" gap="20px">
          <Box>
            <label htmlFor="category-name" style={{ fontSize: "14px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
              Category Name <Text as="span" color="#EF4444">*</Text>
            </label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Electronics"
              required
            />
            <Text fontSize="12px" color="#94A3B8" mt="6px">
              Must be unique across all categories
            </Text>
          </Box>

          <Box>
            <label htmlFor="category-description" style={{ fontSize: "14px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
              Description
            </label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what products belong in this category..."
              rows={3}
            />
          </Box>
        </Flex>

        {error && (
          <Box mt="16px" p="12px" bg="#FEE2E2" borderRadius="8px" fontSize="13px" color="#991B1B">
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
