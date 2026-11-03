import type { ComponentType, ReactNode } from "react";
import AccountPage from "../app/(site)/(panel)/(scroll)/account/page";
import AddPage from "../app/(site)/(panel)/(scroll)/add/page";
import AddEventPage from "../app/(site)/(panel)/(scroll)/add/event/page";
import AddHuntingPage from "../app/(site)/(panel)/(scroll)/add/hunting/page";
import AddProductPage from "../app/(site)/(panel)/(scroll)/add/product/page";
import AddTermPage from "../app/(site)/(panel)/(scroll)/add/term/page";
import EventsEventIdEditPage from "../app/(site)/(panel)/(scroll)/events/[eventId]/edit/page";
import FamilyPage from "../app/(site)/(panel)/(scroll)/family/page";
import FamilyEditPage from "../app/(site)/(panel)/(scroll)/family/edit/page";
import FamilyMembersFamilyMembershipIdEditPage from "../app/(site)/(panel)/(scroll)/family/members/[familyMembershipId]/edit/page";
import FamilyMembersNewPage from "../app/(site)/(panel)/(scroll)/family/members/new/page";
import FamilyNewPage from "../app/(site)/(panel)/(scroll)/family/new/page";
import GroupsPage from "../app/(site)/(panel)/(scroll)/groups/page";
import GroupsGroupIdPage from "../app/(site)/(panel)/(scroll)/groups/[groupId]/page";
import GroupsGroupIdEditPage from "../app/(site)/(panel)/(scroll)/groups/[groupId]/edit/page";
import GroupsNewPage from "../app/(site)/(panel)/(scroll)/groups/new/page";
import HomePage from "../app/(site)/(panel)/(scroll)/home/page";
import ItemsPage from "../app/(site)/(panel)/(scroll)/items/page";
import MeetingsPage from "../app/(site)/(panel)/(scroll)/meetings/page";
import MessagesPage from "../app/(site)/(panel)/(scroll)/messages/page";
import MessagesConversationIdPage from "../app/(site)/(panel)/messages/[conversationId]/page";
import OrganizationPage from "../app/(site)/(panel)/(scroll)/organization/page";
import PlacesPage from "../app/(site)/(panel)/(scroll)/places/page";
import PlacesLocationIdEditPage from "../app/(site)/(panel)/(scroll)/places/[locationId]/edit/page";
import PlacesNewPage from "../app/(site)/(panel)/(scroll)/places/new/page";
import ProfilePage from "../app/(site)/(panel)/(scroll)/profile/page";
import SearchPage from "../app/(site)/(panel)/(scroll)/search/page";
import SettingsPage from "../app/(site)/(panel)/(scroll)/settings/page";
import TermsTermIdPage from "../app/(site)/(panel)/(scroll)/terms/[termId]/page";
import TermsTermIdEditPage from "../app/(site)/(panel)/(scroll)/terms/[termId]/edit/page";
import WantedPage from "../app/(site)/(panel)/(scroll)/wanted/page";

/** Every page under `app/(site)/(panel)` by URL pattern (`panelPages.test.ts`
 * keeps the list in step with the route tree), `/home` also as `/` (the URL
 * the app works with). */
export const PANEL_PAGES: Record<string, ComponentType> = {
  "/": HomePage,
  "/account": AccountPage,
  "/add": AddPage,
  "/add/event": AddEventPage,
  "/add/hunting": AddHuntingPage,
  "/add/product": AddProductPage,
  "/add/term": AddTermPage,
  "/events/:eventId/edit": EventsEventIdEditPage,
  "/family": FamilyPage,
  "/family/edit": FamilyEditPage,
  "/family/members/:familyMembershipId/edit": FamilyMembersFamilyMembershipIdEditPage,
  "/family/members/new": FamilyMembersNewPage,
  "/family/new": FamilyNewPage,
  "/groups": GroupsPage,
  "/groups/:groupId": GroupsGroupIdPage,
  "/groups/:groupId/edit": GroupsGroupIdEditPage,
  "/groups/new": GroupsNewPage,
  "/home": HomePage,
  "/items": ItemsPage,
  "/meetings": MeetingsPage,
  "/messages": MessagesPage,
  "/messages/:conversationId": MessagesConversationIdPage,
  "/organization": OrganizationPage,
  "/places": PlacesPage,
  "/places/:locationId/edit": PlacesLocationIdEditPage,
  "/places/new": PlacesNewPage,
  "/profile": ProfilePage,
  "/search": SearchPage,
  "/settings": SettingsPage,
  "/terms/:termId": TermsTermIdPage,
  "/terms/:termId/edit": TermsTermIdEditPage,
  "/wanted": WantedPage,
};

/** `element` under every panel pattern, so one panel tree (and its state)
 * survives section changes, as under the shared panel layout. */
export function panelRoutes(element: ReactNode): Record<string, ReactNode> {
  return Object.fromEntries(Object.keys(PANEL_PAGES).map((pattern) => [pattern, element]));
}
