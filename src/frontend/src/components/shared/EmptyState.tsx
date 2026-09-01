import { Box, Text } from "@chakra-ui/react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <Box textAlign="center" py="60px" px="24px">
      {icon && (
        <Box color="#94A3B8" mb="16px">
          {icon}
        </Box>
      )}
      <Text fontSize="18px" fontWeight="600" color="#0F172A" mb="8px">
        {title}
      </Text>
      {description && (
        <Text fontSize="14px" color="#64748B" mb="24px">
          {description}
        </Text>
      )}
      {action}
    </Box>
  );
}
