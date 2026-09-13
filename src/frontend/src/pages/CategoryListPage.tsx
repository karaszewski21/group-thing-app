import { Box, Button, Flex, Heading, Table, Text } from "@chakra-ui/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useCategories } from "../hooks/useCategories";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { EmptyState } from "../components/shared/EmptyState";
import { PrimaryButton } from "../components/shared/PrimaryButton";
import { useAuth } from "../auth/AuthContext";
import { extractProblemMessage } from "../api/problem";

/**
 * Structural port of `ProductListPage.tsx`, reduced per
 * `ui-mockups.md` Mockup 2/3: no search/filter row (small admin-curated
 * dictionary, not a large catalog), plus up/down reorder buttons backed by
 * `useCategories().move`. Gated on `ADMIN` (not `EDIT`) per
 * `scope-clarifications.md`.
 */
export function CategoryListPage() {
  const { permissions } = useAuth();
  const isAdmin = permissions.includes("ADMIN");
  const { data: categories, loading, error, remove, move } = useCategories();

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (deleteId === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await remove(deleteId);
      setDeleteId(null);
    } catch (err) {
      // Explicit fix of the generic-catch anti-pattern in
      // ProductFormPage.tsx — the backend's actual 409 `detail` message
      // must reach the still-open dialog verbatim, not a fallback string.
      setDeleteError(extractProblemMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  function closeDeleteDialog() {
    setDeleteId(null);
    setDeleteError(null);
  }

  async function handleMove(id: number, direction: "up" | "down") {
    try {
      await move(id, direction);
    } catch {
      // Reordering failures aren't destructive — the list simply doesn't
      // change; no dedicated error surface needed for this action.
    }
  }

  if (error) {
    return (
      <Box>
        <Text color="red.500">Error: {error}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Flex justify="space-between" align="flex-start" mb="24px">
        <Box>
          <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A">
            Categories
          </Heading>
          <Text fontSize="14px" color="#64748B" mt="4px">
            Manage the product category dictionary
          </Text>
        </Box>
        {isAdmin && (
          <PrimaryButton asChild>
            <Link to="/categories/new">+ Add Category</Link>
          </PrimaryButton>
        )}
      </Flex>

      {loading ? (
        <Text>Loading...</Text>
      ) : categories.length === 0 ? (
        <EmptyState
          title="No categories found"
          description="Create your first category to get started."
          action={
            isAdmin ? (
              <PrimaryButton asChild>
                <Link to="/categories/new">+ Add Category</Link>
              </PrimaryButton>
            ) : undefined
          }
        />
      ) : (
        <Box borderRadius="12px" border="1px solid" borderColor="#E2E8F0" overflow="hidden" bg="white">
          <Table.Root size="md">
            <Table.Header>
              <Table.Row bg="white">
                <Table.ColumnHeader
                  fontSize="12px"
                  fontWeight="600"
                  color="brand.500"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                >
                  Name
                </Table.ColumnHeader>
                <Table.ColumnHeader
                  fontSize="12px"
                  fontWeight="600"
                  color="brand.500"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                >
                  Products in use
                </Table.ColumnHeader>
                {isAdmin && (
                  <Table.ColumnHeader
                    fontSize="12px"
                    fontWeight="600"
                    color="brand.500"
                    textTransform="uppercase"
                    letterSpacing="0.05em"
                    width="180px"
                  >
                    Actions
                  </Table.ColumnHeader>
                )}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {categories.map((category, index) => (
                <Table.Row key={category.id} _hover={{ bg: "#F8FAFC" }}>
                  <Table.Cell fontWeight="500" color="#1E293B">
                    {category.name}
                  </Table.Cell>
                  <Table.Cell color="#334155" fontSize="13px">
                    {category.productCount}
                  </Table.Cell>
                  {isAdmin && (
                    <Table.Cell>
                      <Flex gap="8px" align="center">
                        <Button
                          variant="ghost"
                          size="sm"
                          color="#334155"
                          aria-label={`Move ${category.name} up`}
                          disabled={index === 0}
                          onClick={() => handleMove(category.id, "up")}
                        >
                          <ChevronUp size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          color="#334155"
                          aria-label={`Move ${category.name} down`}
                          disabled={index === categories.length - 1}
                          onClick={() => handleMove(category.id, "down")}
                        >
                          <ChevronDown size={16} />
                        </Button>
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          color="#334155"
                          fontWeight="500"
                          aria-label={`Edit ${category.name}`}
                        >
                          <Link to={`/categories/${category.id}/edit`}>Edit</Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          color="#DC2626"
                          fontWeight="500"
                          aria-label={`Delete ${category.name}`}
                          onClick={() => setDeleteId(category.id)}
                        >
                          Delete
                        </Button>
                      </Flex>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
          <Box px="16px" py="12px" fontSize="13px" color="#64748B">
            Showing {categories.length} {categories.length === 1 ? "category" : "categories"}
          </Box>
        </Box>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        onClose={closeDeleteDialog}
        onConfirm={handleDelete}
        title="Delete Category"
        message="Are you sure you want to delete this category? This action cannot be undone."
        loading={deleting}
        error={deleteError}
      />
    </Box>
  );
}
