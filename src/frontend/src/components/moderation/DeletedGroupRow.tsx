import { Button, Table, Text } from "@chakra-ui/react";
import { useState } from "react";
import type { ModerationGroupResponse } from "../../api/groups";
import dayjs from "../../utils/dayjs";

/** The deleted-at, deleted-by and Restore cells of one soft-deleted Circle in
 * the admin overview. The Restore button keeps its own busy/error state; on
 * success the row leaves the list, so `onRestored` moves focus elsewhere. */
export function DeletedGroupRow({
  group,
  onRestore,
  onRestored,
}: {
  group: ModerationGroupResponse;
  onRestore: () => Promise<void>;
  onRestored: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await onRestore();
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <Table.Cell color="#64748B" fontSize="13px">
        {dayjs.utc(group.deleted_at).local().format("DD.MM.YYYY HH:mm")}
      </Table.Cell>
      <Table.Cell color="#334155" fontSize="13px">
        {group.deleted_by_name ?? (
          <Text as="span" color="#94A3B8" fontStyle="italic">
            Unknown
          </Text>
        )}
      </Table.Cell>
      <Table.Cell>
        <Button
          size="sm"
          colorPalette="green"
          variant="outline"
          disabled={busy}
          aria-label={`Restore ${group.name}`}
          onClick={() => void restore()}
        >
          {busy ? "Restoring…" : "Restore"}
        </Button>
        {error && (
          <Text role="alert" fontSize="13px" color="red.500" mt="4px">
            {error}
          </Text>
        )}
      </Table.Cell>
    </>
  );
}
