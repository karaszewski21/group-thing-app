"use client";

import type { ReactNode } from "react";
import { OrganizerItemLayout } from "../../../../../../../features/items/product/OrganizerItemLayout";

export default function OrganizerProductLayout({ children }: { children: ReactNode }) {
  return <OrganizerItemLayout>{children}</OrganizerItemLayout>;
}
