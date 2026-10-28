import { Box, Button, Flex, Heading, Input, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Category } from "../../api/categories";
import { useCategories } from "../../hooks/useCategories";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog";
import { EmptyState } from "../../components/shared/EmptyState";
import { PrimaryButton } from "../../components/shared/PrimaryButton";
import { useAuth } from "../../auth/AuthContext";
import { extractProblemMessage } from "../../api/problem";
import { buildCategoryIndex, foldCategoryText, searchCategories, type CategoryIndex } from "../../utils/categoryTree";

const HAS_PRODUCTS_TITLE = "Kategoria ma przypisane rzeczy";
const NEW_ROOT_LABEL = "+ Nowa kategoria główna";
const INDENT_PX = 28;

const pluralRules = new Intl.PluralRules("pl");
const SUBCATEGORY_FORMS: Partial<Record<Intl.LDMLPluralRule, string>> = {
  one: "podkategoria",
  few: "podkategorie",
  many: "podkategorii",
};
const ITEM_FORMS: Partial<Record<Intl.LDMLPluralRule, string>> = { one: "rzecz", few: "rzeczy", many: "rzeczy" };

function countLabel(n: number, forms: Partial<Record<Intl.LDMLPluralRule, string>>): string {
  return `${n} ${forms[pluralRules.select(n)] ?? forms.many}`;
}

function metaLabel(childCount: number, productCount: number): string {
  if (childCount > 0) return countLabel(childCount, SUBCATEGORY_FORMS);
  return productCount > 0 ? countLabel(productCount, ITEM_FORMS) : "";
}

interface FilterResult {
  /** Categories whose name matches the filter. */
  matches: ReadonlySet<string>;
  /** Ancestors of the matches: the branches that contain a match. */
  branches: ReadonlySet<string>;
}

function filterTree(index: CategoryIndex, query: string): FilterResult | null {
  if (foldCategoryText(query.trim()) === "") return null;
  const matches = new Set<string>();
  const branches = new Set<string>();
  for (const { category } of searchCategories(index, query).results) {
    matches.add(category.id);
    let parentId = category.parent_id;
    while (parentId !== null && !branches.has(parentId)) {
      branches.add(parentId);
      parentId = index.byId.get(parentId)?.parent_id ?? null;
    }
  }
  return { matches, branches };
}

/**
 * Admin category tree: nested lists with disclosure buttons (not `role="tree"`),
 * sibling ↑/↓ reordering, and backend conflicts in a top alert. Gated on `ADMIN`.
 */
export function CategoryListPage() {
  const { permissions } = useAuth();
  const isAdmin = permissions.includes("ADMIN");
  const { data: categories, loading, error, remove, move } = useCategories();
  const index = useMemo(() => buildCategoryIndex(categories), [categories]);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => filterTree(index, filter), [index, filter]);
  // A new filter text opens the branches holding its matches; new data under an
  // unchanged filter opens its new branches too, keeping the ones the admin opened
  // (adjusted during render, so the tree is filtered once per keystroke).
  const [expandedFor, setExpandedFor] = useState({ filter, index });
  if (expandedFor.filter !== filter || expandedFor.index !== index) {
    const filterChanged = expandedFor.filter !== filter;
    setExpandedFor({ filter, index });
    if (filtered) {
      setExpanded((current) => new Set([...(filterChanged ? [] : current), ...filtered.branches]));
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete() {
    if (deleteTarget === null) return;
    setDeleting(true);
    setActionError(null);
    try {
      await remove(deleteTarget.id);
    } catch (err) {
      // `remove` already rethrows the backend message as a plain Error.
      setActionError(err instanceof Error ? err.message : extractProblemMessage(err));
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  async function handleMove(id: string, direction: "up" | "down") {
    setActionError(null);
    try {
      await move(id, direction);
    } catch (err) {
      setActionError(extractProblemMessage(err));
    }
  }

  /** Children to render under `parentId`; inside a matched subtree the filter no longer applies. */
  function visibleChildren(parentId: string | null, insideMatch: boolean): readonly Category[] {
    const children = index.childrenOf(parentId);
    if (!filtered || insideMatch) return children;
    return children.filter((c) => filtered.matches.has(c.id) || filtered.branches.has(c.id));
  }

  function renderLevel(parentId: string | null, depth: number, insideMatch: boolean) {
    const siblings = index.childrenOf(parentId);
    const rows = visibleChildren(parentId, insideMatch);
    return (
      <Box as="ul" listStyleType="none" m="0" p="0" aria-label={parentId === null ? "Kategorie" : undefined}>
        {rows.map((category) => {
          const childCount = index.childrenOf(category.id).length;
          const isOpen = childCount > 0 && expanded.has(category.id);
          const childrenInsideMatch = insideMatch || Boolean(filtered?.matches.has(category.id));
          return (
            <li key={category.id}>
              <CategoryRow
                category={category}
                depth={depth}
                childCount={childCount}
                isOpen={isOpen}
                isAdmin={isAdmin}
                isFirst={siblings[0] === category}
                isLast={siblings[siblings.length - 1] === category}
                onToggle={() => toggle(category.id)}
                onMove={(direction) => void handleMove(category.id, direction)}
                onDelete={() => setDeleteTarget(category)}
              />
              {isOpen && renderLevel(category.id, depth + 1, childrenInsideMatch)}
            </li>
          );
        })}
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Text color="red.500">Błąd: {error}</Text>
      </Box>
    );
  }

  const newRootButton = isAdmin ? (
    <PrimaryButton asChild>
      <Link to="/admin/categories/new">{NEW_ROOT_LABEL}</Link>
    </PrimaryButton>
  ) : undefined;

  return (
    <Box>
      <Flex justify="space-between" align="flex-start" mb="24px" gap="12px" wrap="wrap">
        <Box>
          <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A">
            Kategorie
          </Heading>
          <Text fontSize="14px" color="#64748B" mt="4px">
            Drzewo kategorii rzeczy
          </Text>
        </Box>
        {newRootButton}
      </Flex>

      {actionError && (
        <Box role="alert" mb="14px" p="12px" bg="#FEE2E2" borderRadius="8px" fontSize="13px" color="#991B1B">
          {actionError}
        </Box>
      )}

      {loading ? (
        <Text>Ładowanie…</Text>
      ) : categories.length === 0 ? (
        <EmptyState title="Brak kategorii" description="Dodaj pierwszą kategorię główną." action={newRootButton} />
      ) : (
        <>
          <Input
            aria-label="Filtruj po nazwie"
            placeholder="Filtruj po nazwie…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            bg="white"
            mb="12px"
          />
          <Box borderRadius="12px" border="1px solid" borderColor="#E2E8F0" overflow="hidden" bg="white">
            {filtered && filtered.matches.size === 0 ? (
              <Text px="16px" py="12px" fontSize="14px" color="#64748B">
                Brak kategorii pasujących do „{filter.trim()}”.
              </Text>
            ) : (
              renderLevel(null, 0, false)
            )}
          </Box>
        </>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Usunąć kategorię?"
        message={`Kategoria „${deleteTarget?.name ?? ""}” zostanie trwale usunięta.`}
        confirmLabel="Usuń"
        loading={deleting}
      />
    </Box>
  );
}

function CategoryRow({
  category,
  depth,
  childCount,
  isOpen,
  isAdmin,
  isFirst,
  isLast,
  onToggle,
  onMove,
  onDelete,
}: {
  category: Category;
  depth: number;
  childCount: number;
  isOpen: boolean;
  isAdmin: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}) {
  const hasProducts = category.product_count > 0;
  const lockedTitle = hasProducts ? HAS_PRODUCTS_TITLE : undefined;
  const addChildLabel = `+ Podkategoria w ${category.name}`;

  return (
    <Flex
      data-testid={`category-row-${category.name}`}
      align="center"
      gap="10px"
      wrap="wrap"
      py="8px"
      pr="12px"
      pl={`${12 + depth * INDENT_PX}px`}
      borderBottom="1px solid"
      borderColor="#F1F5F9"
      _hover={{ bg: "#F8FAFC" }}
    >
      <Box flex="1" minW="160px">
        {childCount > 0 ? (
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={onToggle}
            style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 500, color: "#1E293B" }}
          >
            <Box as="span" aria-hidden="true" w="16px" color="#64748B" textAlign="center">
              {isOpen ? "▾" : "▸"}
            </Box>
            {category.name}
          </button>
        ) : (
          <Text as="span" fontWeight="500" color="#1E293B" pl="22px">
            {category.name}
          </Text>
        )}
      </Box>
      <Text as="span" fontSize="12px" color="#64748B" minW="120px">
        {metaLabel(childCount, category.product_count)}
      </Text>
      {isAdmin && (
        <Flex gap="6px" align="center" wrap="wrap">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Przenieś ${category.name} w górę`}
            disabled={isFirst}
            onClick={() => onMove("up")}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Przenieś ${category.name} w dół`}
            disabled={isLast}
            onClick={() => onMove("down")}
          >
            ↓
          </Button>
          {hasProducts ? (
            <Button variant="ghost" size="sm" aria-label={addChildLabel} disabled title={lockedTitle}>
              + Podkategoria
            </Button>
          ) : (
            <Button asChild variant="ghost" size="sm" aria-label={addChildLabel}>
              <Link to={`/admin/categories/new?parent=${category.id}`}>+ Podkategoria</Link>
            </Button>
          )}
          <Button asChild variant="ghost" size="sm" aria-label={`Edytuj ${category.name}`}>
            <Link to={`/admin/categories/${category.id}/edit`}>Edytuj</Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            color="#DC2626"
            aria-label={`Usuń ${category.name}`}
            disabled={hasProducts}
            title={lockedTitle}
            onClick={onDelete}
          >
            Usuń
          </Button>
        </Flex>
      )}
    </Flex>
  );
}
