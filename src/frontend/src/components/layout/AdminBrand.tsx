import Image from "next/image";
import { Flex, Text } from "@chakra-ui/react";
import { Link } from "../../routing/navigation";

/** The Gooo mark and name at the top of the admin Sidebar / MobileDrawer.
 * The logo has a white background, so it sits on a white tile over the dark
 * sidebar. Leads back to the public Start. */
export function AdminBrand({ onClick }: { onClick?: () => void }) {
  return (
    <Link to="/" onClick={onClick} aria-label="Gooo — Start" style={{ textDecoration: "none" }}>
      <Flex align="center" gap="10px">
        <Flex bg="white" borderRadius="10px" p="3px" flexShrink={0}>
          <Image src="/assets/logo-gooo-96.webp" alt="" width={32} height={32} priority />
        </Flex>
        <Flex direction="column" lineHeight="1.1">
          <Text fontSize="18px" fontWeight="800" color="white" letterSpacing="-0.3px">
            Gooo
          </Text>
          <Text fontSize="11px" fontWeight="600" color="rgba(255,255,255,0.6)" textTransform="uppercase" letterSpacing="0.6px">
            Panel admina
          </Text>
        </Flex>
      </Flex>
    </Link>
  );
}
