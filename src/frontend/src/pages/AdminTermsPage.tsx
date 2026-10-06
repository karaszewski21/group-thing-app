import { Box, Heading, Table, Text } from "@chakra-ui/react";
import { useState } from "react";
import { PAGE_SIZE } from "../api/pagination";
import { AdminTable } from "../components/shared/AdminTable";
import { EmptyState } from "../components/shared/EmptyState";
import { Pagination } from "../components/shared/Pagination";
import { useModerationTerms } from "../hooks/useModerationTerms";
import dayjs from "../utils/dayjs";

/** ADMIN-only, read-only overview of the latest Terms across every Circle,
 * latest first, with their active signups (guardians and children). */
export function AdminTermsPage() {
  const [page, setPage] = useState(1);
  const { data: terms, total, loading, error } = useModerationTerms(page);

  return (
    <Box>
      <Box mb="24px">
        <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A">
          Terms
        </Heading>
        <Text fontSize="14px" color="#64748B" mt="4px">
          Every Circle's terms, latest first
        </Text>
      </Box>
      {error ? (
        <Text color="red.500">Error: {error}</Text>
      ) : loading ? (
        <Text>Loading...</Text>
      ) : terms.length === 0 ? (
        <EmptyState title="No terms found" />
      ) : (
        <AdminTable
          columns={["Date", "Circle", "Description", "Signups", "Children"]}
          footer={`Showing ${terms.length} of ${total} ${total === 1 ? "term" : "terms"}`}
        >
          {terms.map((term) => (
            <Table.Row key={term.id} _hover={{ bg: "#F8FAFC" }}>
              <Table.Cell fontWeight="500" color="#1E293B" whiteSpace="nowrap">
                {dayjs(term.occurs_on).format("D MMM YYYY, HH:mm")}
              </Table.Cell>
              <Table.Cell color="#334155" fontSize="13px">
                {term.group_name}
              </Table.Cell>
              <Table.Cell color="#334155" fontSize="13px">
                {term.description ?? (
                  <Text as="span" color="#94A3B8" fontStyle="italic">
                    No description
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell color="#334155" fontSize="13px">
                {term.attendee_count}
              </Table.Cell>
              <Table.Cell color="#334155" fontSize="13px">
                {term.child_count}
              </Table.Cell>
            </Table.Row>
          ))}
        </AdminTable>
      )}
      <Pagination page={page} size={PAGE_SIZE} total={total} onPageChange={setPage} />
    </Box>
  );
}
