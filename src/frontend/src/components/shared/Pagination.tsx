import { Button, Flex, Text } from "@chakra-ui/react";
import { useEffect } from "react";

/** Previous/Next pager for a 1-based `page` of `size` rows out of `total`.
 * Steps back to the last page when it no longer exists (e.g. after its last
 * row was deleted). Renders nothing for a single page. */
export function Pagination({
  page,
  size,
  total,
  onPageChange,
}: {
  page: number;
  size: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / size));

  useEffect(() => {
    if (page > totalPages) onPageChange(totalPages);
  }, [page, totalPages, onPageChange]);

  if (totalPages <= 1) return null;

  return (
    <Flex as="nav" aria-label="Pagination" justify="space-between" align="center" mt="16px" gap="12px">
      <Text fontSize="13px" color="#64748B">
        Page {page} of {totalPages} · {total} total
      </Text>
      <Flex gap="8px">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </Flex>
    </Flex>
  );
}
