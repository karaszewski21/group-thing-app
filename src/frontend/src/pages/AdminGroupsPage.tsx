import { Box, Button, HStack, Heading, Table, Text } from "@chakra-ui/react";
import { useRef, useState } from "react";
import { PAGE_SIZE } from "../api/pagination";
import { DeletedGroupRow } from "../components/moderation/DeletedGroupRow";
import { AdminTable } from "../components/shared/AdminTable";
import { EmptyState } from "../components/shared/EmptyState";
import { Pagination } from "../components/shared/Pagination";
import { useModerationGroups } from "../hooks/useModerationGroups";
import dayjs from "../utils/dayjs";

const STATUS_FILTERS: { deleted: boolean; label: string }[] = [
  { deleted: false, label: "Active" },
  { deleted: true, label: "Deleted" },
];

const ACTIVE_COLUMNS = ["Name", "Organizer", "Members", "Terms", "Created"];
const DELETED_COLUMNS = [...ACTIVE_COLUMNS, "Deleted at", "Deleted by", "Actions"];

/** ADMIN-only overview of every Circle in the system — organizer, member
 * count, term count, created date — for spotting empty or abandoned Circles.
 * The Deleted view lists soft-deleted Circles with who deleted them and a
 * Restore action. */
export function AdminGroupsPage() {
  const [deleted, setDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const deletedFilterRef = useRef<HTMLButtonElement>(null);
  const { data: groups, total, loading, error, restore } = useModerationGroups(page, deleted);

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
      <HStack gap="8px" mb="16px" flexWrap="wrap" role="group" aria-label="Group status">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.label}
            ref={filter.deleted ? deletedFilterRef : undefined}
            size="sm"
            variant={filter.deleted === deleted ? "solid" : "outline"}
            aria-pressed={filter.deleted === deleted}
            onClick={() => {
              setDeleted(filter.deleted);
              setPage(1);
            }}
          >
            {filter.label}
          </Button>
        ))}
      </HStack>
      {error ? (
        <Text color="red.500">Error: {error}</Text>
      ) : loading ? (
        <Text>Loading...</Text>
      ) : groups.length === 0 ? (
        <EmptyState title={deleted ? "No deleted circles" : "No circles found"} />
      ) : (
        <AdminTable
          columns={deleted ? DELETED_COLUMNS : ACTIVE_COLUMNS}
          footer={`Showing ${groups.length} of ${total} ${deleted ? "deleted " : ""}${total === 1 ? "circle" : "circles"}`}
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
              {deleted && (
                <DeletedGroupRow
                  group={group}
                  onRestore={() => restore(group.id)}
                  onRestored={() => deletedFilterRef.current?.focus()}
                />
              )}
            </Table.Row>
          ))}
        </AdminTable>
      )}
      <Pagination page={page} size={PAGE_SIZE} total={total} onPageChange={setPage} />
    </Box>
  );
}
