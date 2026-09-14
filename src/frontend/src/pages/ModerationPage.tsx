import { Box, Heading, Table, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { getGroupsForModeration } from "../api/groups";
import type { ModerationGroupResponse } from "../api/groups";
import { EmptyState } from "../components/shared/EmptyState";
import { extractProblemMessage } from "../api/problem";
import { formatDate } from "../utils/format";

/**
 * ADMIN-only, read-only overview of every Circle in the system — organizer,
 * member count, term count, created date — for spotting empty or abandoned
 * Circles. No destructive actions; back-office equivalent of CategoryListPage.
 */
export function ModerationPage() {
  const [groups, setGroups] = useState<ModerationGroupResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getGroupsForModeration()
      .then((data) => {
        if (!cancelled) setGroups(data);
      })
      .catch((err) => {
        if (!cancelled) setError(extractProblemMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Box>
        <Text color="red.500">Error: {error}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Box mb="24px">
        <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A">
          Moderation
        </Heading>
        <Text fontSize="14px" color="#64748B" mt="4px">
          Every Circle in the system, at a glance
        </Text>
      </Box>

      {loading ? (
        <Text>Loading...</Text>
      ) : groups.length === 0 ? (
        <EmptyState title="No circles found" />
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
                  Organizer
                </Table.ColumnHeader>
                <Table.ColumnHeader
                  fontSize="12px"
                  fontWeight="600"
                  color="brand.500"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                >
                  Members
                </Table.ColumnHeader>
                <Table.ColumnHeader
                  fontSize="12px"
                  fontWeight="600"
                  color="brand.500"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                >
                  Terms
                </Table.ColumnHeader>
                <Table.ColumnHeader
                  fontSize="12px"
                  fontWeight="600"
                  color="brand.500"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                >
                  Created
                </Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {groups.map((group) => (
                <Table.Row key={group.id} _hover={{ bg: "#F8FAFC" }}>
                  <Table.Cell fontWeight="500" color="#1E293B">
                    {group.name}
                  </Table.Cell>
                  <Table.Cell color="#334155" fontSize="13px">
                    {group.organizer_name ?? (
                      <Text as="span" color="#94A3B8" fontStyle="italic">
                        No organizer
                      </Text>
                    )}
                    {group.organizer_email && (
                      <Text as="span" color="#94A3B8" fontSize="12px" ml="6px">
                        ({group.organizer_email})
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell color="#334155" fontSize="13px">
                    {group.member_count}
                  </Table.Cell>
                  <Table.Cell color="#334155" fontSize="13px">
                    {group.term_count}
                  </Table.Cell>
                  <Table.Cell color="#64748B" fontSize="13px">
                    {formatDate(group.created_at)}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
          <Box px="16px" py="12px" fontSize="13px" color="#64748B">
            Showing {groups.length} {groups.length === 1 ? "circle" : "circles"}
          </Box>
        </Box>
      )}
    </Box>
  );
}
