import { Box, Button, Heading, HStack, Text } from "@chakra-ui/react";
import { useState } from "react";
import type { ModerationStatus } from "../api/products";
import { PhotoModerationCard } from "../components/moderation/PhotoModerationCard";
import { EmptyState } from "../components/shared/EmptyState";
import { useModerationPhotos } from "../hooks/useModerationPhotos";

const STATUS_FILTERS: { status: ModerationStatus | null; label: string }[] = [
  { status: null, label: "All" },
  { status: "APPROVED", label: "Approved" },
  { status: "NEEDS_REVIEW", label: "Needs review" },
  { status: "PENDING", label: "Pending" },
  { status: "REJECTED", label: "Rejected" },
];

/** ADMIN-only: every photo users upload, newest first, filterable by
 * moderation status, with Approve/Reject to change any photo's status and
 * Delete to remove it from the database and storage. */
export function PhotoModerationPage() {
  const [status, setStatus] = useState<ModerationStatus | null>(null);
  const { data, loading, error, decide, remove } = useModerationPhotos(status);

  return (
    <Box>
      <Box mb="24px">
        <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A">
          Photos
        </Heading>
        <Text fontSize="14px" color="#64748B" mt="4px">
          Every uploaded photo, newest first
        </Text>
      </Box>
      <HStack gap="8px" mb="16px" flexWrap="wrap" role="group" aria-label="Photo status">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.label}
            size="sm"
            variant={filter.status === status ? "solid" : "outline"}
            aria-pressed={filter.status === status}
            onClick={() => setStatus(filter.status)}
          >
            {filter.label}
          </Button>
        ))}
      </HStack>
      {error ? (
        <Text color="red.500">Error: {error}</Text>
      ) : loading ? (
        <Text>Loading...</Text>
      ) : data.length === 0 ? (
        <EmptyState title="No photos" />
      ) : (
        <Box as="ul" display="flex" flexDirection="column" gap="12px">
          {data.map((entry) => (
            <PhotoModerationCard
              key={entry.subject_id}
              entry={entry}
              onDecide={(outcome) =>
                decide({ subject_type: entry.subject_type, subject_id: entry.subject_id, outcome })
              }
              onDelete={() => remove(entry.subject_id)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
