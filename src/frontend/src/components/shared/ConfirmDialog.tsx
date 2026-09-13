import {
  Box,
  Button,
  DialogBackdrop,
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPositioner,
  DialogRoot,
  DialogTitle,
  Flex,
  Text,
} from "@chakra-ui/react";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  /** Optional error banner rendered inside the dialog body, above the
   * footer buttons — for a rejection (e.g. a 409 conflict) that should be
   * shown to the user without closing the dialog. Additive only: callers
   * that don't pass it see no change in behavior or markup. */
  error?: string | null;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Delete",
  loading = false,
  error = null,
}: ConfirmDialogProps) {
  return (
    <DialogRoot
      open={open}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
      role="alertdialog"
    >
      <DialogBackdrop />
      <DialogPositioner>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Text>{message}</Text>
            {error && (
              <Box
                mt="12px"
                p="12px"
                bg="#FEE2E2"
                color="#991B1B"
                borderRadius="8px"
                fontSize="13px"
                aria-live="polite"
              >
                {error}
              </Box>
            )}
          </DialogBody>
          <DialogFooter>
            <Flex gap="12px">
              <Button variant="outline" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                colorPalette="red"
                onClick={onConfirm}
                loading={loading}
              >
                {confirmLabel}
              </Button>
            </Flex>
          </DialogFooter>
          <DialogCloseTrigger />
        </DialogContent>
      </DialogPositioner>
    </DialogRoot>
  );
}
