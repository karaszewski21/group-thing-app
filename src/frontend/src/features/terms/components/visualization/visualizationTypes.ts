export type GroupLayoutMode = "CIRCLE" | "PITCH" | "TABLE";

/** One avatar in the visualization — a person signed up for the Term. */
export interface VisualizationFamily {
  familyId: string;
  name: string;
  /** Renders the "udostępnia rzecz" (shares) marker on the avatar. */
  sharesItem?: boolean;
  /** Renders the "przynosi na zajęcia" (brings) marker on the avatar. */
  bringsItem?: boolean;
}

/** What all three layouts read. */
export interface LayoutProps {
  families: VisualizationFamily[];
  organizerName: string;
  activeFamilyId: string | null;
  onSelectFamily: (familyId: string) => void;
}
