import type { Metadata } from "next";
import { AboutPointsView } from "../../../../features/points/AboutPointsView";

export const metadata: Metadata = {
  title: "Punkty i reputacja",
  description: "Jak zdobywać punkty i reputację za oddawanie rzeczy, wymiany i obecność na spotkaniach.",
};

export default function Page() {
  return <AboutPointsView />;
}
