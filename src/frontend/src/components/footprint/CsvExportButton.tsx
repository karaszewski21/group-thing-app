import { useEffect, useRef, useState } from "react";
import { Button, HStack, Text } from "@chakra-ui/react";
import { getFootprintCsvExport } from "../../api/footprints";
import { downloadBlob } from "../../utils/download";
import { extractProblemMessage } from "../../api/problem";

interface CsvExportButtonProps {
  correlationId: string;
  onError?: (message: string) => void;
}

type Status = "idle" | "exporting" | "done" | "error";

export function CsvExportButton({ correlationId, onError }: CsvExportButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  const handleClick = async () => {
    if (status === "exporting") return;
    setStatus("exporting");
    setMessage("Exporting…");
    try {
      const blob = await getFootprintCsvExport(correlationId);
      const filename = `footprint-${correlationId}.csv`;
      downloadBlob(blob, filename);
      setStatus("done");
      setMessage(`Downloaded ${filename}`);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => {
        setStatus("idle");
        setMessage("");
      }, 3000);
    } catch (err) {
      const msg = extractProblemMessage(err);
      setStatus("error");
      setMessage(msg);
      if (onError) onError(msg);
    }
  };

  return (
    <HStack gap="12px">
      <Button
        type="button"
        onClick={handleClick}
        disabled={status === "exporting"}
        size="sm"
        variant="outline"
      >
        Export CSV
      </Button>
      <Text
        as="span"
        role="status"
        aria-live="polite"
        fontSize="13px"
        color={status === "error" ? "red.600" : "gray.600"}
      >
        {message}
      </Text>
    </HStack>
  );
}
