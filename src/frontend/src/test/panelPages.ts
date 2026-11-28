import type { ComponentType, ReactNode } from "react";
import AccountPage from "../app/(public)/(panel)/account/page";
import AccountPointsPage from "../app/(public)/(panel)/points/page";
import AddPage from "../app/(public)/(panel)/add/page";
import AddEventPage from "../app/(public)/(panel)/add/event/page";
import AddProductPage from "../app/(public)/(panel)/add/product/page";
import AddTermPage from "../app/(public)/(panel)/add/term/page";
import AddWantedPage from "../app/(public)/(panel)/add/wanted/page";
import EventsEventIdEditPage from "../app/(public)/(panel)/events/[eventId]/edit/page";
import FamilyPage from "../app/(public)/(panel)/family/page";
import FamilyEditPage from "../app/(public)/(panel)/family/edit/page";
import FamilyMembersFamilyMembershipIdEditPage from "../app/(public)/(panel)/family/members/[familyMembershipId]/edit/page";
import FamilyMembersNewPage from "../app/(public)/(panel)/family/members/new/page";
import FamilyNewPage from "../app/(public)/(panel)/family/new/page";
import GroupsPage from "../app/(public)/(panel)/groups/page";
import GroupsGroupIdPage from "../app/(public)/(panel)/groups/[groupId]/page";
import GroupsGroupIdEditPage from "../app/(public)/(panel)/groups/[groupId]/edit/page";
import GroupsNewPage from "../app/(public)/(panel)/groups/new/page";
import HomePage from "../app/(public)/(panel)/home/page";
import ItemsPage from "../app/(public)/(panel)/items/page";
import ItemsIdEditPage from "../app/(public)/(panel)/items/[id]/edit/page";
import ItemsReservedPage from "../app/(public)/(panel)/items/reserved/page";
import MeetingsPage from "../app/(public)/(panel)/meetings/page";
import MessagesPage from "../app/(public)/(panel)/messages/page";
import MessagesConversationIdPage from "../app/(public)/(panel)/messages/[conversationId]/page";
import OrganizationPage from "../app/(public)/(panel)/organization/page";
import PlacesPage from "../app/(public)/(panel)/places/page";
import PlacesLocationIdEditPage from "../app/(public)/(panel)/places/[locationId]/edit/page";
import PlacesNewPage from "../app/(public)/(panel)/places/new/page";
import ProfilePage from "../app/(public)/(panel)/profile/page";
import SettingsPage from "../app/(public)/(panel)/settings/page";
import TermsTermIdAttendeesPage from "../app/(public)/(panel)/terms/[termId]/attendees/page";
import TermsTermIdEditPage from "../app/(public)/(panel)/terms/[termId]/edit/page";
import WantedPage from "../app/(public)/(panel)/wanted/page";
import WantedIdPage from "../app/(public)/(panel)/wanted/[id]/page";
import WantedIdEditPage from "../app/(public)/(panel)/wanted/[id]/edit/page";

/** Every page under `app/(public)/(panel)` by URL pattern (`panelPages.test.ts`
 * keeps the list in step with the route tree), `/home` also as `/` (the URL
 * the app works with). */
export const PANEL_PAGES: Record<string, ComponentType> = {
  "/": HomePage,
  "/account": AccountPage,
  "/points": AccountPointsPage,
  "/add": AddPage,
  "/add/event": AddEventPage,
  "/add/product": AddProductPage,
  "/add/term": AddTermPage,
  "/add/wanted": AddWantedPage,
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
  "/places": PlacesPage,
  "/places/:locationId/edit": PlacesLocationIdEditPage,
  "/places/new": PlacesNewPage,
  "/profile": ProfilePage,
  "/settings": SettingsPage,
  "/terms/:termId/attendees": TermsTermIdAttendeesPage,
  "/terms/:termId/edit": TermsTermIdEditPage,
  "/wanted": WantedPage,
  "/wanted/:id": WantedIdPage,
  "/wanted/:id/edit": WantedIdEditPage,
};

/** `element` under every panel pattern, so one panel tree (and its state)
 * survives section changes, as under the shared panel layout. */
export function panelRoutes(element: ReactNode): Record<string, ReactNode> {
  return Object.fromEntries(Object.keys(PANEL_PAGES).map((pattern) => [pattern, element]));
}
