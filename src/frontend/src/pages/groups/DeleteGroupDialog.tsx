import type { GroupResponse } from "../../api/groups";
import { ConfirmDeleteDialog } from "../../components/shared/ConfirmDeleteDialog";

interface DeleteGroupDialogProps {
  group: GroupResponse;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function DeleteGroupDialog({ group, onConfirm, onClose }: DeleteGroupDialogProps) {
  return (
    <ConfirmDeleteDialog
      title={`Usunąć grupę „${group.name}”?`}
      body="Grupa zniknie dla uczestników. Jeśli to pomyłka, napisz do nas — przywrócimy ją."
      confirmLabel="Usuń grupę"
      fallbackError="Nie udało się usunąć grupy. Spróbuj ponownie."
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
