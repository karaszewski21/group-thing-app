import { Box, Text } from "@chakra-ui/react";
import { useParams, useLocation } from "react-router-dom";
import { usePluginContext } from "../plugins/PluginContext";
import { MENU_MAIN } from "../plugins/extensionPoints";
import { PluginFrame } from "../plugins/PluginFrame";

export function PluginPageRoute() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const location = useLocation();
  const { plugins, loading } = usePluginContext();

  if (loading) return <Text>Loading plugin...</Text>;

  const plugin = plugins.find((p) => p.id === pluginId);

  if (!plugin) {
    return (
      <Box p="32px">
        <Text color="red.500">Plugin not found: {pluginId}</Text>
      </Box>
    );
  }

  // Extract the path after /plugins/:pluginId
  const basePath = `/plugins/${pluginId}`;
  const pluginPath = location.pathname.slice(basePath.length) || "/";

  return (
    <Box h="100%" minH="calc(100vh - 120px)">
      <PluginFrame
        pluginId={plugin.id}
        pluginName={plugin.name}
        pluginUrl={plugin.url}
        contextType={MENU_MAIN}
        path={pluginPath}
      />
    </Box>
  );
}
