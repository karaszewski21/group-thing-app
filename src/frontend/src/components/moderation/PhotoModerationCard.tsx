import { Box, Button, HStack, Image, Text } from "@chakra-ui/react";
import { useState } from "react";
import type { ModerationQueueEntry } from "../../api/moderation";
import type { ModerationStatus } from "../../api/products";
import dayjs from "../../utils/dayjs";
import { ConfirmDialog } from "../shared/ConfirmDialog";

const STATUS_LABELS: Record<ModerationStatus, string> = {
  APPROVED: "Approved",
  NEEDS_REVIEW: "Needs review",
  PENDING: "Pending",
  REJECTED: "Rejected",
};

function formatScores(scores: Record<string, number> | null): string {
  if (!scores) return "No model score";
  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([label, score]) => `${label} ${score.toFixed(2)}`)
    .join(" · ");
}

/** One uploaded photo with its status, model scores and the admin's
 * actions: Approve/Reject (each offered only when it changes the status)
 * and a confirmed, irreversible Delete. */
export function PhotoModerationCard({
  entry,
  onDecide,
  onDelete,
}: {
  entry: ModerationQueueEntry;
  onDecide: (outcome: "APPROVED" | "REJECTED") => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = entry.subject_type === "AVATAR" ? `Avatar · ${entry.product_name}` : entry.product_name;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

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

  return (
    <Box as="li" listStyleType="none" border="1px solid" borderColor="#E2E8F0" borderRadius="12px" bg="white" p="16px">
      <HStack align="flex-start" gap="16px">
        {entry.photo_url && (
          <Image src={entry.photo_url} alt={`Photo of ${title}`} boxSize="120px" objectFit="cover" borderRadius="8px" />
        )}
        <Box flex="1" minW="0">
          <Text fontSize="12px" fontWeight="600" color="brand.500" textTransform="uppercase">
            {STATUS_LABELS[entry.status]}
          </Text>
          <Text fontWeight="600" color="#0F172A">
            {title}
          </Text>
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
          <Button size="sm" colorPalette="red" variant="ghost" disabled={busy} onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        </HStack>
      </HStack>
      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => {
          setConfirmingDelete(false);
          setDeleteError(null);
        }}
        onConfirm={() => void confirmDelete()}
        title="Delete photo"
        message={`Delete this photo of "${title}"? It is removed from the database and storage. This action cannot be undone.`}
        loading={deleting}
        error={deleteError}
      />
    </Box>
  );
}
