import { Box, Button, Flex, Heading, Input, Text, Textarea } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getCategory } from "../../api/categories";
import { extractProblemMessage } from "../../api/problem";
import { CategoryTreePicker } from "../../components/shared/CategoryTreePicker";
import { PrimaryButton } from "../../components/shared/PrimaryButton";
import { useCategories } from "../../hooks/useCategories";
import { buildCategoryIndex, formatCategoryPath } from "../../utils/categoryTree";

const labelStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#334155",
  display: "block",
  marginBottom: "6px",
};

const PARENT_LABEL_ID = "category-parent-label";
const PARENT_HINT_ID = "category-parent-hint";
const ROOT_TEXT = "Brak (kategoria główna)";

/**
 * Shared between `/admin/categories/new[?parent=<id>]` and `/admin/categories/:id/edit`.
 * The parent is chosen only on create; the backend has no reparenting.
 */
export function CategoryFormPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [parentId, setParentId] = useState<string | null>(() => (id ? null : searchParams.get("parent")));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: categories, create, update } = useCategories();
  const index = useMemo(() => buildCategoryIndex(categories), [categories]);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      if (id) {
        const category = await getCategory(id);
        setName(category.name);
        setDescription(category.description ?? "");
        setParentId(category.parent_id);
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
    try {
      if (isEdit && id) {
        await update(id, { name, description: description || undefined });
      } else {
        await create({ name, description: description || undefined, parent_id: parentId });
      }
      navigate("/admin/categories");
    } catch (err) {
      setError(extractProblemMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (loadingData) {
    return <Text>Ładowanie…</Text>;
  }

  const title = isEdit ? "Edytuj kategorię" : parentId ? "Nowa podkategoria" : "Nowa kategoria główna";

  return (
    <Box maxW="800px">
      <Box mb="24px">
        <Flex as="nav" fontSize="13px" color="#64748B" gap="4px" aria-label="Breadcrumb">
          <Link to="/admin/categories" style={{ color: "var(--chakra-colors-brand-600)", textDecoration: "none" }}>
            Kategorie
          </Link>
          <Text as="span">/</Text>
          <Text as="span">{title}</Text>
        </Flex>
        <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A" mt="4px">
          {title}
        </Heading>
      </Box>

      <Box as="form" onSubmit={handleSubmit} bg="white" border="1px solid" borderColor="#E2E8F0" borderRadius="12px" p="32px">
        <Flex direction="column" gap="20px" maxW="520px">
          <Box>
            <span id={PARENT_LABEL_ID} style={labelStyle}>
              Kategoria nadrzędna
            </span>
            {isEdit ? (
              <Text color="#334155" fontSize="14px">
                {parentId ? formatCategoryPath(index, parentId) || `#${parentId}` : ROOT_TEXT}
              </Text>
            ) : (
              <>
                <CategoryTreePicker
                  labelledBy={PARENT_LABEL_ID}
                  value={parentId}
                  onChange={setParentId}
                  mode="any"
                  allowRoot
                  placeholder={ROOT_TEXT}
                  aria-describedby={PARENT_HINT_ID}
                />
                <Text id={PARENT_HINT_ID} fontSize="12px" color="#94A3B8" mt="6px">
                  Puste = kategoria główna. Nie można zmienić po utworzeniu.
                </Text>
              </>
            )}
          </Box>

          <Box>
            <label htmlFor="category-name" style={labelStyle}>
              Nazwa
            </label>
            <Input id="category-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Box>

          <Box>
            <label htmlFor="category-description" style={labelStyle}>
              Opis (opcjonalnie)
            </label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </Box>
        </Flex>

        {error && (
          <Box role="alert" mt="16px" p="12px" bg="#FEE2E2" borderRadius="8px" fontSize="13px" color="#991B1B">
            {error}
          </Box>
        )}

        <Flex gap="12px" mt="28px" pt="20px" borderTop="1px solid" borderColor="#F1F5F9">
          <PrimaryButton type="submit" loading={loading}>
            Zapisz
          </PrimaryButton>
          <Button asChild variant="outline">
            <Link to="/admin/categories">Anuluj</Link>
          </Button>
        </Flex>
      </Box>
    </Box>
  );
}
