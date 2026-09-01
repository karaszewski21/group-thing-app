import { Button } from "@chakra-ui/react";
import type { ComponentProps } from "react";

type ButtonProps = ComponentProps<typeof Button>;

export function PrimaryButton(props: ButtonProps) {
  return <Button colorPalette="blue" {...props} />;
}
