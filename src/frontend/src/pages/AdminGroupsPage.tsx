import { Box, Heading, Table, Text } from "@chakra-ui/react";
import { AdminTable } from "../components/shared/AdminTable";
import { EmptyState } from "../components/shared/EmptyState";
import { useModerationGroups } from "../hooks/useModerationGroups";
import dayjs from "../utils/dayjs";

/** ADMIN-only, read-only overview of every Circle in the system — organizer,
 * member count, term count, created date — for spotting empty or abandoned
 * Circles. */
export function AdminGroupsPage() {
  const { data: groups, loading, error } = useModerationGroups();

  return (
    <Box>
      <Box mb="24px">
        <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A">
          Groups
        </Heading>
        <Text fontSize="14px" color="#64748B" mt="4px">
          Every Circle in the system, at a glance
        </Text>
      </Box>
      {error ? (
        <Text color="red.500">Error: {error}</Text>
      ) : loading ? (
        <Text>Loading...</Text>
      ) : groups.length === 0 ? (
        <EmptyState title="No circles found" />
      ) : (
        <AdminTable
          columns={["Name", "Organizer", "Members", "Terms", "Created"]}
          footer={`Showing ${groups.length} ${groups.length === 1 ? "circle" : "circles"}`}
        >
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
                {dayjs(group.created_at).format("D MMM YYYY")}
              </Table.Cell>
            </Table.Row>
          ))}
        </AdminTable>
      )}
    </Box>
  );
}
