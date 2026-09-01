import {
  Box,
  Button,
  Flex,
  Heading,
  Text,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPlugin, setPluginEnabled } from "../api/plugins";
import type { PluginResponse } from "../api/plugins";

export function PluginDetailPage() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const [plugin, setPlugin] = useState<PluginResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const loadPlugin = useCallback(async () => {
    if (!pluginId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getPlugin(pluginId);
      setPlugin(data);
    } catch {
      setError("Failed to load plugin.");
    } finally {
      setLoading(false);
    }
  }, [pluginId]);

  useEffect(() => {
    void loadPlugin();
  }, [loadPlugin]);

  async function handleToggleEnabled() {
    if (!plugin || !pluginId) return;
    setToggling(true);
    try {
      const updated = await setPluginEnabled(pluginId, !plugin.enabled);
      setPlugin(updated);
    } catch {
      setError("Failed to update plugin status.");
    } finally {
      setToggling(false);
    }
  }

  if (loading) return <Text>Loading...</Text>;
  if (error) return <Text color="red.500">{error}</Text>;
  if (!plugin) return <Text>Plugin not found.</Text>;

  return (
    <Box maxW="800px">
      <Box mb="24px">
        <Flex as="nav" fontSize="13px" color="#64748B" gap="4px" aria-label="Breadcrumb">
          <Link to="/plugins" style={{ color: "var(--chakra-colors-brand-600)", textDecoration: "none" }}>
            Plugins
          </Link>
          <Text as="span">/</Text>
          <Text as="span">{plugin.name}</Text>
        </Flex>
        <Flex justify="space-between" align="center" mt="4px">
          <Heading as="h1" fontSize="24px" fontWeight="700" color="#0F172A">
            {plugin.name}
          </Heading>
          <Button asChild variant="outline" size="sm">
            <Link to={`/plugins/${plugin.id}/edit`}>Edit</Link>
          </Button>
        </Flex>
      </Box>

      <Box bg="white" border="1px solid" borderColor="#E2E8F0" borderRadius="12px" p="32px">
        <Flex direction="column" gap="16px">
          <Box>
            <Text fontSize="12px" fontWeight="600" color="#64748B" textTransform="uppercase">
              Plugin ID
            </Text>
            <Text fontFamily="monospace" color="#334155">{plugin.id}</Text>
          </Box>
          <Box>
            <Text fontSize="12px" fontWeight="600" color="#64748B" textTransform="uppercase">
              Version
            </Text>
            <Text color="#334155">{plugin.version}</Text>
          </Box>
          <Box>
            <Text fontSize="12px" fontWeight="600" color="#64748B" textTransform="uppercase">
              URL
            </Text>
            <Text color="#334155">{plugin.url}</Text>
          </Box>
          {plugin.description && (
            <Box>
              <Text fontSize="12px" fontWeight="600" color="#64748B" textTransform="uppercase">
                Description
              </Text>
              <Text color="#334155">{plugin.description}</Text>
            </Box>
          )}
          <Box>
            <Text fontSize="12px" fontWeight="600" color="#64748B" textTransform="uppercase" mb="8px">
              Enabled
            </Text>
            <Button
              size="sm"
              colorPalette={plugin.enabled ? "green" : "red"}
              variant="outline"
              onClick={handleToggleEnabled}
              loading={toggling}
            >
              {plugin.enabled ? "Enabled" : "Disabled"}
            </Button>
          </Box>
          <Box>
            <Text fontSize="12px" fontWeight="600" color="#64748B" textTransform="uppercase" mb="8px">
              Extension Points
            </Text>
            {plugin.extensionPoints.length === 0 ? (
              <Text color="#94A3B8" fontSize="13px">No extension points defined.</Text>
            ) : (
              <Box
                as="pre"
                p="16px"
                bg="#F8FAFC"
                borderRadius="8px"
                fontSize="13px"
                fontFamily="monospace"
                overflow="auto"
                border="1px solid"
                borderColor="#E2E8F0"
              >
                {JSON.stringify(plugin.extensionPoints, null, 2)}
              </Box>
            )}
          </Box>
        </Flex>
      </Box>
    </Box>
  );
}
