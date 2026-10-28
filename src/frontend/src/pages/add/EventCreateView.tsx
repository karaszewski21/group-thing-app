import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppData } from "../../app/appDataStore";
import { SubPageHeader } from "../../components/shared/appComponents";
import { LOCATIONS_KEY } from "../../hooks/useMyLocations";
import { usePlugins } from "../../hooks/usePlugins";
import { ADD_EVENT } from "../../plugins/extensionPoints";
import { PluginFrame } from "../../plugins/PluginFrame";
import { usePluginMessageHandler } from "../../plugins/usePluginMessageHandler";
import { viewPath } from "../../utils/appHelpers";
import type { EventCreateView as EventCreateViewState } from "./eventCreateViewState";
import { resolveEventCreateView } from "./eventCreateViewState";

const MAX_TOAST_NAME = 120;

// Top bar, bottom nav, the panel's vertical padding and the SubPageHeader (246 px,
// +64 px of PhoneFrame padding from 520 px), so only the iframe scrolls.
const FRAME_BOX = "h-[calc(100dvh-250px)] min-h-[400px] min-[520px]:h-[calc(100dvh-314px)]";
const FRAME_STYLE = { display: "block" };

function savedToast(payload: Record<string, unknown>): string {
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, MAX_TOAST_NAME) : "";
  return name ? `Wydarzenie „${name}” zapisane` : "Wydarzenie zapisane";
}

/** "Nowe wydarzenie" — the host chrome around the events plugin's form,
 * reached from /add. The plugin sends `done` once the event is saved. */
export function EventCreateView() {
  const plugins = usePlugins();
  const view = resolveEventCreateView({ loading: plugins.loading, error: plugins.error, plugins: plugins.data });
  const { showToast } = useAppData();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const readyPluginId = view.kind === "ready" ? view.point.pluginId : null;

  const onDone = useCallback(
    (pluginId: string, payload: Record<string, unknown>) => {
      if (pluginId !== readyPluginId) return;
      showToast(savedToast(payload));
      // The plugin may have added a place through hostApp.fetch.
      void queryClient.invalidateQueries({ queryKey: [LOCATIONS_KEY] });
      navigate(viewPath("add"));
    },
    [readyPluginId, showToast, queryClient, navigate],
  );
  usePluginMessageHandler({ onDone });

  return (
    <>
      <SubPageHeader title="Nowe wydarzenie" backTo={viewPath("add")} backLabel="Wróć do dodawania" />
      <EventCreateBody view={view} />
    </>
  );
}

function EventCreateBody({ view }: { view: EventCreateViewState }) {
  switch (view.kind) {
    case "loading":
      return (
        <p role="status" className="text-sm text-ink-soft">
          Wczytywanie…
        </p>
      );
    case "unavailable":
      return (
        <>
          <div className="flex flex-col items-center gap-2.5 rounded-3xl border border-line bg-paper px-2.5 py-10 text-center">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-[26px]"
            >
              🎈
            </span>
            <h2 className="font-serif text-xl font-extrabold text-ink">Plugin wydarzeń jest niedostępny</h2>
            <p className="text-sm text-ink-soft">Dodawanie wydarzeń jest chwilowo wyłączone. Spróbuj później.</p>
          </div>
          <Link
            to={viewPath("add")}
            className="mt-4 flex min-h-12 items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-[15px] font-extrabold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Wróć do dodawania
          </Link>
        </>
      );
    case "ready":
      return (
        <div className={FRAME_BOX}>
          <PluginFrame
            pluginId={view.point.pluginId}
            pluginName={view.point.pluginName}
            pluginUrl={view.point.pluginUrl}
            contextType={ADD_EVENT}
            path={view.point.path ?? "/"}
            title="Formularz nowego wydarzenia"
            style={FRAME_STYLE}
          />
        </div>
      );
  }
}
