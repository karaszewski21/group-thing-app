import type { ComponentType, ReactNode } from "react";
import AccountPage from "../app/(site)/(panel)/account/page";
import AddPage from "../app/(site)/(panel)/add/page";
import AddEventPage from "../app/(site)/(panel)/add/event/page";
import AddHuntingPage from "../app/(site)/(panel)/add/hunting/page";
import AddProductPage from "../app/(site)/(panel)/add/product/page";
import AddTermPage from "../app/(site)/(panel)/add/term/page";
import EventsEventIdEditPage from "../app/(site)/(panel)/events/[eventId]/edit/page";
import FamilyPage from "../app/(site)/(panel)/family/page";
import FamilyEditPage from "../app/(site)/(panel)/family/edit/page";
import FamilyMembersFamilyMembershipIdEditPage from "../app/(site)/(panel)/family/members/[familyMembershipId]/edit/page";
import FamilyMembersNewPage from "../app/(site)/(panel)/family/members/new/page";
import FamilyNewPage from "../app/(site)/(panel)/family/new/page";
import GroupsPage from "../app/(site)/(panel)/groups/page";
import GroupsGroupIdPage from "../app/(site)/(panel)/groups/[groupId]/page";
import GroupsGroupIdEditPage from "../app/(site)/(panel)/groups/[groupId]/edit/page";
import GroupsNewPage from "../app/(site)/(panel)/groups/new/page";
import HomePage from "../app/(site)/(panel)/home/page";
import ItemsPage from "../app/(site)/(panel)/items/page";
import ItemsIdEditPage from "../app/(site)/(panel)/items/[id]/edit/page";
import ItemsReservedPage from "../app/(site)/(panel)/items/reserved/page";
import MeetingsPage from "../app/(site)/(panel)/meetings/page";
import MessagesPage from "../app/(site)/(panel)/messages/page";
import MessagesConversationIdPage from "../app/(site)/(panel)/messages/[conversationId]/page";
import OrganizationPage from "../app/(site)/(panel)/organization/page";
import OrganizationAppearancePage from "../app/(site)/(panel)/organization/appearance/page";
import PlacesPage from "../app/(site)/(panel)/places/page";
import PlacesLocationIdEditPage from "../app/(site)/(panel)/places/[locationId]/edit/page";
import PlacesNewPage from "../app/(site)/(panel)/places/new/page";
import ProfilePage from "../app/(site)/(panel)/profile/page";
import SearchPage from "../app/(site)/(panel)/search/page";
import TermsTermIdAttendeesPage from "../app/(site)/(panel)/terms/[termId]/attendees/page";
import TermsTermIdEditPage from "../app/(site)/(panel)/terms/[termId]/edit/page";
import WantedPage from "../app/(site)/(panel)/wanted/page";

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
  "/items/:id/edit": ItemsIdEditPage,
  "/items/reserved": ItemsReservedPage,
  "/meetings": MeetingsPage,
  "/messages": MessagesPage,
  "/messages/:conversationId": MessagesConversationIdPage,
  "/organization": OrganizationPage,
  "/organization/appearance": OrganizationAppearancePage,
  "/places": PlacesPage,
  "/places/:locationId/edit": PlacesLocationIdEditPage,
  "/places/new": PlacesNewPage,
  "/profile": ProfilePage,
  "/search": SearchPage,
  "/terms/:termId/attendees": TermsTermIdAttendeesPage,
  "/terms/:termId/edit": TermsTermIdEditPage,
  "/wanted": WantedPage,
};

/** `element` under every panel pattern, so one panel tree (and its state)
 * survives section changes, as under the shared panel layout. */
export function panelRoutes(element: ReactNode): Record<string, ReactNode> {
  return Object.fromEntries(Object.keys(PANEL_PAGES).map((pattern) => [pattern, element]));
}
