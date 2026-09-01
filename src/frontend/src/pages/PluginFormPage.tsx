import {
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getPlugin, uploadManifest } from "../api/plugins";
import type { ManifestPayload } from "../api/plugins";
import { PrimaryButton } from "../components/shared/PrimaryButton";

const labelStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#334155",
  display: "block",
  marginBottom: "6px",
};

const DEFAULT_MANIFEST: ManifestPayload = {
  name: "",
  version: "1.0.0",
  url: "",
  description: "",
  extensionPoints: [],
};

export function PluginFormPage() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(pluginId);

  const [id, setId] = useState(pluginId ?? "");
  const [manifestJson, setManifestJson] = useState(JSON.stringify(DEFAULT_MANIFEST, null, 2));
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  const loadPlugin = useCallback(async () => {
    if (!pluginId) return;
    setLoadingData(true);
    try {
      const plugin = await getPlugin(pluginId);
      setId(plugin.id);
      const manifest: ManifestPayload = {
        name: plugin.name,
        version: plugin.version,
        url: plugin.url,
        description: plugin.description ?? undefined,
        extensionPoints: plugin.extensionPoints,
      };
      setManifestJson(JSON.stringify(manifest, null, 2));
    } catch {
      setError("Failed to load plugin.");
    } finally {
      setLoadingData(false);
    }
  }, [pluginId]);

  useEffect(() => {
    void loadPlugin();
  }, [loadPlugin]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!id.trim()) {
      setError("Plugin ID is required.");
      return;
    }

    let manifest: ManifestPayload;
    try {
      manifest = JSON.parse(manifestJson);
    } catch {
      setError("Invalid JSON in manifest field.");
      return;
    }

    setLoading(true);
    try {
      await uploadManifest(id.trim(), manifest);
      navigate(`/plugins/${id.trim()}/detail`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save plugin.");
    } finally {
      setLoading(false);
    }
  }

  if (loadingData) return <Text>Loading...</Text>;

  return (
    <Box maxW="700px">
      <Box mb="24px">
        <Flex as="nav" fontSize="13px" color="#64748B" gap="4px" aria-label="Breadcrumb">
          <Link to="/plugins" style={{ color: "var(--chakra-colors-brand-600)", textDecoration: "none" }}>
            Plugins
          </Link>
          <Text as="span">/</Text>
          <Text as="span">{isEdit ? "Edit Plugin" : "Add New Plugin"}</Text>
        </Flex>
        <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A" mt="4px">
          {isEdit ? "Edit Plugin" : "Add New Plugin"}
        </Heading>
      </Box>

      <Box as="form" onSubmit={handleSubmit} bg="white" border="1px solid" borderColor="#E2E8F0" borderRadius="12px" p="32px">
        <Flex direction="column" gap="20px">
          <Box>
            <label htmlFor="plugin-id" style={labelStyle}>
              Plugin ID <Text as="span" color="#EF4444">*</Text>
            </label>
            <Input
              id="plugin-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="e.g. warehouse"
              required
              disabled={isEdit}
            />
            <Text fontSize="12px" color="#94A3B8" mt="6px">
              Unique identifier for the plugin. Cannot be changed after creation.
            </Text>
          </Box>

          <Box>
            <label htmlFor="plugin-manifest" style={labelStyle}>
              Manifest (JSON) <Text as="span" color="#EF4444">*</Text>
            </label>
            <Textarea
              id="plugin-manifest"
              value={manifestJson}
              onChange={(e) => setManifestJson(e.target.value)}
              fontFamily="monospace"
              fontSize="13px"
              rows={16}
              placeholder='{"name": "...", "version": "1.0.0", "url": "..."}'
            />
            <Text fontSize="12px" color="#94A3B8" mt="6px">
              JSON manifest with name, version, url, description, and extensionPoints
            </Text>
          </Box>
        </Flex>

        {error && (
          <Box mt="16px" p="12px" bg="#FEE2E2" borderRadius="8px" fontSize="13px" color="#991B1B">
            {error}
          </Box>
        )}

        <Flex justify="flex-end" gap="12px" mt="28px" pt="20px" borderTop="1px solid" borderColor="#F1F5F9">
          <Button asChild variant="outline">
            <Link to="/plugins">Cancel</Link>
          </Button>
          <PrimaryButton type="submit" loading={loading}>
            Save Plugin
          </PrimaryButton>
        </Flex>
      </Box>
    </Box>
  );
}
