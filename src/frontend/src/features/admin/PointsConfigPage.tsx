import { Box, Button, Flex, Heading, Input, Text } from "@chakra-ui/react";
import { useState, type ReactNode } from "react";
import type { PointsConfig } from "../../api/points";
import { PrimaryButton } from "../../components/shared/PrimaryButton";
import { usePointsConfig } from "../../hooks/usePointsConfig";
import {
  configToForm,
  MULTIPLIER_LABELS,
  NEW_LEVEL_MESSAGE,
  parseConfigForm,
  parseLevel,
  priceExampleText,
  type PointsConfigField,
  type PointsConfigForm,
} from "./pointsConfigForm";

const labelStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#334155",
  display: "block",
  marginBottom: "6px",
};

const LEVELS_LABEL_ID = "points-levels-label";
const LEVELS_ERROR_ID = "points-levels-error";
const NEW_LEVEL_ERROR_ID = "points-new-level-error";

type TextField = Exclude<PointsConfigField, "attendance_levels">;

/** `/admin/points`: the admin-tunable point thresholds. Gated on `ADMIN` by the backend. */
export function PointsConfigPage() {
  const { data, loading, error, update } = usePointsConfig();
  const [saved, setSaved] = useState(false);

  async function handleSave(request: PointsConfig) {
    await update(request);
    setSaved(true);
  }

  return (
    <Box maxW="800px">
      <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A" mb="16px">
        Konfiguracja punktów
      </Heading>
      <Box bg="#EAF2CE" color="#56701F" borderRadius="8px" px="14px" py="10px" fontSize="13px" fontWeight="600" mb="20px">
        Zmiany dotyczą tylko przyszłych zdarzeń. Nie zmieniają już przyznanych punktów ani wycen istniejących
        przedmiotów.
      </Box>
      {error ? (
        <Text color="red.500">Błąd: {error}</Text>
      ) : loading || data === null ? (
        <Text>Ładowanie…</Text>
      ) : (
        // A fresh form per saved version, so it shows the stored (sorted) values.
        <PointsConfigEditor
          key={data.updated_at}
          config={data}
          saved={saved}
          onEdit={() => setSaved(false)}
          onSave={handleSave}
        />
      )}
    </Box>
  );
}

function PointsConfigEditor({
  config,
  saved,
  onEdit,
  onSave,
}: {
  config: PointsConfig;
  saved: boolean;
  onEdit: () => void;
  onSave: (request: PointsConfig) => Promise<void>;
}) {
  const [form, setForm] = useState<PointsConfigForm>(() => configToForm(config));
  const [newLevel, setNewLevel] = useState("");
  const [newLevelError, setNewLevelError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { value, errors } = parseConfigForm(form);
  const priceExample = priceExampleText(form);

  function edit(patch: Partial<PointsConfigForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setSaveError(null);
    onEdit();
  }

  function addLevel() {
    const level = parseLevel(newLevel);
    if (level === undefined) {
      setNewLevelError(NEW_LEVEL_MESSAGE);
      return;
    }
    edit({ attendance_levels: [...form.attendance_levels, level].sort((a, b) => a - b) });
    setNewLevel("");
    setNewLevelError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (value === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...value, updated_at: config.updated_at });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const field = (name: TextField, label: string, decimal = false) => (
    <NumberField
      key={name}
      id={`points-${name}`}
      label={label}
      value={form[name]}
      error={errors[name]}
      decimal={decimal}
      onChange={(raw) => edit({ [name]: raw })}
    />
  );

  const levelsDescribedBy = [errors.attendance_levels && LEVELS_ERROR_ID, newLevelError && NEW_LEVEL_ERROR_ID]
    .filter(Boolean)
    .join(" ");

  return (
    <Box as="form" onSubmit={handleSubmit} bg="white" border="1px solid" borderColor="#E2E8F0" borderRadius="12px" p={{ base: "18px", md: "32px" }}>
      <Section legend="Wycena przedmiotu – baza wg klasy wielkości">
        <FieldGrid>
          {field("base_small", "Mała")}
          {field("base_medium", "Średnia")}
          {field("base_large", "Duża")}
        </FieldGrid>
        <Hint>Wynik jest zaokrąglany do 20 / 40 / 60 (poniżej 30 → 20; 30–49 → 40; od 50 → 60).</Hint>
      </Section>

      <Section legend="Mnożniki stanu">
        <FieldGrid>
          {(Object.entries(MULTIPLIER_LABELS) as [TextField, string][]).map(([name, label]) => field(name, label, true))}
        </FieldGrid>
      </Section>

      <Section legend="Nagrody">
        <FieldGrid>
          {field("swap_award", "Wymiana – każda strona")}
          {field("wants_bonus", "Bonus „Szukam”")}
        </FieldGrid>
        <Hint>Oddanie za darmo daje oddającemu punkty i reputację równe wycenie przedmiotu.</Hint>
      </Section>

      <Section legend="Obecność na terminach">
        <span id={LEVELS_LABEL_ID} style={labelStyle}>
          Dozwolone poziomy (organizator wybiera jeden)
        </span>
        <Flex gap="8px" wrap="wrap" align="center">
          <Flex as="ul" aria-label="Dozwolone poziomy" gap="8px" wrap="wrap" listStyleType="none" m="0" p="0">
            {form.attendance_levels.map((level, i) => (
              <Flex
                as="li"
                key={`${level}-${i}`}
                align="center"
                gap="4px"
                border="1px solid"
                borderColor="#CBD5E1"
                borderRadius="8px"
                bg="#F8FAFC"
                pl="10px"
                pr="2px"
                py="2px"
                fontSize="14px"
              >
                {level}
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`Usuń poziom ${level}`}
                  onClick={() => edit({ attendance_levels: form.attendance_levels.filter((_, j) => j !== i) })}
                >
                  ✕
                </Button>
              </Flex>
            ))}
          </Flex>
          <Input
            aria-label="Nowy poziom"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="+ poziom"
            maxW="110px"
            value={newLevel}
            aria-invalid={newLevelError ? true : undefined}
            aria-describedby={levelsDescribedBy || undefined}
            onChange={(e) => {
              setNewLevel(e.target.value);
              setNewLevelError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLevel();
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={addLevel}>
            Dodaj
          </Button>
        </Flex>
        {errors.attendance_levels && <FieldError id={LEVELS_ERROR_ID}>{errors.attendance_levels}</FieldError>}
        {newLevelError && <FieldError id={NEW_LEVEL_ERROR_ID}>{newLevelError}</FieldError>}
        <Box mt="14px">
          <FieldGrid>
            {field("attendance_monthly_cap", "Limit miesięczny na osobę")}
            {field("attendance_min_present", "Min. liczba obecnych")}
            {field("attendance_auto_close_days", "Auto-zamknięcie listy po (dni)")}
          </FieldGrid>
        </Box>
      </Section>

      <Section legend="Ochrona przed nabijaniem">
        <FieldGrid>
          {field("pair_reward_limit", "Nagradzane transakcje na parę")}
          {field("pair_window_days", "w oknie (dni)")}
        </FieldGrid>
      </Section>

      <Section legend="Oferty „za punkty”">
        <FieldGrid>
          {field("max_points_offers", "Limit ofert za punkty")}
          {field("price_min_ratio", "Minimum ceny (× sugestia)", true)}
          {field("price_max_ratio", "Maksimum ceny (× sugestia)", true)}
          {field("price_cap", "Cena maksymalna")}
          {field("price_step", "Krok ceny")}
        </FieldGrid>
        {priceExample && (
          <Text bg="#F1F5F9" borderRadius="8px" px="14px" py="10px" fontSize="13px" color="#334155" mt="12px">
            {priceExample}
          </Text>
        )}
      </Section>

      <PrimaryButton type="submit" loading={saving} disabled={value === null}>
        Zapisz konfigurację
      </PrimaryButton>
      {saveError && (
        <Box role="alert" mt="12px" p="12px" bg="#FEE2E2" borderRadius="8px" fontSize="13px" color="#991B1B">
          {saveError}
        </Box>
      )}
      {saved && !saveError && (
        <Text role="status" mt="12px" fontSize="13px" fontWeight="600" color="#117B63">
          Zapisano konfigurację.
        </Text>
      )}
    </Box>
  );
}

function Section({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <Box
      as="fieldset"
      border="1px solid"
      borderColor="#E2E8F0"
      borderRadius="10px"
      px="20px"
      pt="8px"
      pb="16px"
      mb="20px"
    >
      <Box as="legend" fontWeight="700" fontSize="15px" color="#0F172A" px="6px">
        {legend}
      </Box>
      {children}
    </Box>
  );
}

function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(150px, 1fr))" gap="12px">
      {children}
    </Box>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <Text fontSize="12.5px" color="#64748B" mt="6px">
      {children}
    </Text>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Text id={id} role="alert" fontSize="13px" fontWeight="600" color="#B23B3B" mt="6px">
      {children}
    </Text>
  );
}

function NumberField({
  id,
  label,
  value,
  error,
  decimal,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  decimal: boolean;
  onChange: (raw: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <Box>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <Input
        id={id}
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        pattern={decimal ? undefined : "[0-9]*"}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Box>
  );
}
