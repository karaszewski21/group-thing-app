import { Box, Table } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** The bordered admin overview table: a header row of `columns` over the
 * caller's `Table.Row`s, with a footer line below. */
export function AdminTable({
  columns,
  children,
  footer,
}: {
  columns: string[];
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Box borderRadius="12px" border="1px solid" borderColor="#E2E8F0" overflow="hidden" bg="white">
      <Table.Root size="md">
        <Table.Header>
          <Table.Row bg="white">
            {columns.map((column) => (
              <Table.ColumnHeader
                key={column}
                fontSize="12px"
                fontWeight="600"
                color="brand.500"
                textTransform="uppercase"
                letterSpacing="0.05em"
              >
                {column}
              </Table.ColumnHeader>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>{children}</Table.Body>
      </Table.Root>
      <Box px="16px" py="12px" fontSize="13px" color="#64748B">
        {footer}
      </Box>
    </Box>
  );
}
