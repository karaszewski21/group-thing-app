import { Box, Button, Heading, HStack, Image, Text } from "@chakra-ui/react";
import { useState } from "react";
import type { ModerationQueueEntry } from "../api/moderation";
import type { ModerationStatus } from "../api/products";
import { EmptyState } from "../components/shared/EmptyState";
import { useModerationQueue } from "../hooks/useModerationQueue";
import dayjs from "../utils/dayjs";

const STATUS_TABS: { status: ModerationStatus; label: string }[] = [
  { status: "NEEDS_REVIEW", label: "Needs review" },
  { status: "PENDING", label: "Pending (not scored yet)" },
  { status: "REJECTED", label: "Rejected" },
];

function formatScores(scores: Record<string, number> | null): string {
  if (!scores) return "No model score";
  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([label, score]) => `${label} ${score.toFixed(2)}`)
    .join(" · ");
}

function QueueCard({
  entry,
  onDecide,
}: {
  entry: ModerationQueueEntry;
  onDecide: (outcome: "APPROVED" | "REJECTED") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(outcome: "APPROVED" | "REJECTED") {
    setBusy(true);
    setError(null);
    try {
      await onDecide(outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const isPhoto = entry.subject_type === "PHOTO";
  return (
    <Box as="li" listStyleType="none" border="1px solid" borderColor="#E2E8F0" borderRadius="12px" bg="white" p="16px">
      <HStack align="flex-start" gap="16px">
        {isPhoto && entry.photo_url && (
          <Image src={entry.photo_url} alt={`Photo of ${entry.product_name}`} boxSize="120px" objectFit="cover" borderRadius="8px" />
        )}
        <Box flex="1" minW="0">
          <Text fontSize="12px" fontWeight="600" color="brand.500" textTransform="uppercase">
            {isPhoto ? "Photo" : "Name + description"}
          </Text>
          <Text fontWeight="600" color="#0F172A">
            {entry.product_name}
          </Text>
          {!isPhoto && entry.description && (
            <Text fontSize="14px" color="#334155" whiteSpace="pre-wrap" mt="4px">
              {entry.description}
            </Text>
          )}
          <Text fontSize="12px" color="#64748B" mt="8px">
            {formatScores(entry.scores)}
            {entry.model_id ? ` (${entry.model_id})` : ""} · {dayjs(entry.submitted_at).format("DD.MM.YYYY HH:mm")}
          </Text>
          {error && (
            <Text role="alert" fontSize="13px" color="red.500" mt="4px">
              {error}
            </Text>
          )}
        </Box>
        <HStack gap="8px">
          {entry.status !== "APPROVED" && (
            <Button size="sm" colorPalette="green" disabled={busy} onClick={() => void decide("APPROVED")}>
              Approve
            </Button>
          )}
          {entry.status !== "REJECTED" && (
            <Button size="sm" colorPalette="red" variant="outline" disabled={busy} onClick={() => void decide("REJECTED")}>
              Reject
            </Button>
          )}
        </HStack>
      </HStack>
    </Box>
  );
}

/** ADMIN review of uploaded photos and product names/descriptions the
 * moderation models flagged (or have not scored yet). Approving a photo
 * publishes it; rejecting hides it from everyone but its owners. */
export function ContentModerationQueue() {
  const [status, setStatus] = useState<ModerationStatus>("NEEDS_REVIEW");
  const { data, loading, error, decide } = useModerationQueue(status);

  return (
    <Box mb="32px">
      <Heading as="h2" fontSize="18px" fontWeight="700" color="#0F172A">
        Content review
      </Heading>
      <HStack gap="8px" mt="12px" mb="16px" role="group" aria-label="Queue status">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.status}
            size="sm"
            variant={tab.status === status ? "solid" : "outline"}
            aria-pressed={tab.status === status}
            onClick={() => setStatus(tab.status)}
          >
            {tab.label}
          </Button>
        ))}
      </HStack>
      {error ? (
        <Text color="red.500">Error: {error}</Text>
      ) : loading ? (
        <Text>Loading...</Text>
      ) : data.length === 0 ? (
        <EmptyState title="Nothing to review" />
      ) : (
        <Box as="ul" display="flex" flexDirection="column" gap="12px">
          {data.map((entry) => (
            <QueueCard
              key={`${entry.subject_type}-${entry.subject_id}`}
              entry={entry}
              onDecide={(outcome) =>
                decide({ subject_type: entry.subject_type, subject_id: entry.subject_id, outcome })
              }
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
