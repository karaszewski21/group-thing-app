import { Box, Heading, Input, Text } from "@chakra-ui/react";
import { useState } from "react";
import type { AppSettingsResponse } from "../../api/settings";
import { PrimaryButton } from "../../components/shared/PrimaryButton";
import { useAppSettings } from "../../hooks/useAppSettings";
import { parseMaxFeaturedItems } from "./settingsForm";

const FIELD_ID = "settings-max-featured-items";
const HELP_ID = `${FIELD_ID}-help`;
const ERROR_ID = `${FIELD_ID}-error`;

/** `/admin/settings`: the general app settings. Gated on `ADMIN` by the backend. */
export function SettingsPage() {
  const { data, loading, error, update } = useAppSettings();
  const [saved, setSaved] = useState(false);

  async function handleSave(request: AppSettingsResponse) {
    await update(request);
    setSaved(true);
  }

  return (
    <Box maxW="800px">
      <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A" mb="4px">
        Ustawienia
      </Heading>
      <Text fontSize="14px" color="#64748B" mb="20px">
        Ogólne ustawienia aplikacji
      </Text>
      {error ? (
        <Text color="red.500">Błąd: {error}</Text>
      ) : loading || data === null ? (
        <Text>Ładowanie…</Text>
      ) : (
        // A fresh form per saved version, so it shows the stored value.
        <SettingsEditor
          key={data.updated_at}
          settings={data}
          saved={saved}
          onEdit={() => setSaved(false)}
          onSave={handleSave}
        />
      )}
    </Box>
  );
}

function SettingsEditor({
  settings,
  saved,
  onEdit,
  onSave,
}: {
  settings: AppSettingsResponse;
  saved: boolean;
  onEdit: () => void;
  onSave: (request: AppSettingsResponse) => Promise<void>;
}) {
  const [raw, setRaw] = useState(() => String(settings.max_featured_items));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { value, error } = parseMaxFeaturedItems(raw);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (value === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ max_featured_items: value, updated_at: settings.updated_at });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box as="form" onSubmit={handleSubmit} bg="white" border="1px solid" borderColor="#E2E8F0" borderRadius="12px" p={{ base: "18px", md: "32px" }}>
      <Box as="fieldset" border="1px solid" borderColor="#E2E8F0" borderRadius="10px" px="20px" pt="8px" pb="16px" mb="20px">
        <Box as="legend" fontWeight="700" fontSize="15px" color="#0F172A" px="6px">
          Wyróżnione rzeczy
        </Box>
        <label
          htmlFor={FIELD_ID}
          style={{ fontSize: "14px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}
        >
          Limit wyróżnionych rzeczy
        </label>
        <Input
          id={FIELD_ID}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxW="140px"
          value={raw}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${HELP_ID} ${ERROR_ID}` : HELP_ID}
          onChange={(e) => {
            setRaw(e.target.value);
            setSaveError(null);
            onEdit();
          }}
        />
        <Text id={HELP_ID} fontSize="12.5px" color="#64748B" mt="6px">
          Ile rzeczy jeden użytkownik może wyróżnić naraz (0–20). 0 = wyróżnianie wyłączone. Po zmniejszeniu limitu
          istniejące wyróżnienia zostają.
        </Text>
        {error && (
          <Text id={ERROR_ID} role="alert" fontSize="13px" fontWeight="600" color="#B23B3B" mt="6px">
            {error}
          </Text>
        )}
      </Box>

      <PrimaryButton type="submit" loading={saving} disabled={value === null}>
        Zapisz
      </PrimaryButton>
      {saveError && (
        <Box role="alert" mt="12px" p="12px" bg="#FEE2E2" borderRadius="8px" fontSize="13px" color="#991B1B">
          {saveError}
        </Box>
      )}
      {saved && !saveError && (
        <Text role="status" mt="12px" fontSize="13px" fontWeight="600" color="#117B63">
          Zapisano ustawienia.
        </Text>
      )}
    </Box>
  );
}
