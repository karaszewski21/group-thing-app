import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { deleteGroup, type GroupResponse } from "../../api/groups";
import { serverMessageOr } from "../../api/problem";
import { useAppData } from "../../app/appDataStore";
import { SubPageHeader } from "../../components/shared/appComponents";
import { LayoutModeIcon, PencilIcon, TrashIcon } from "../../components/shared/appIcons";
import { groupEditPath, viewPath } from "../../utils/appHelpers";
import { pluralPl } from "../../utils/plural";
import { DeleteGroupDialog } from "./DeleteGroupDialog";

const SECTION_TITLE = "font-serif text-[21px] font-bold text-ink";
const SECTION_COUNT = "font-sans text-base font-semibold text-ink-soft";
const EMPTY = "rounded-[22px] border border-dashed border-line bg-paper p-5 text-center text-[13px] text-ink-soft";
const ADD_BUTTON =
  "flex min-h-10 flex-none items-center rounded-full border-[1.5px] border-line bg-paper px-3.5 text-sm font-extrabold text-ink hover:border-line-strong";
const GROUP_TONES =["bg-accent-soft", "bg-primary-soft"];
const LAYOUT_LABEL = { CIRCLE: "Krąg", PITCH: "Boisko", TABLE: "Stół" } as const;
const GROUP_ICON_TONES = ["bg-accent text-ink", "bg-primary text-on-primary"];
const TILE_BUTTON =
  "flex h-9 w-9 items-center justify-center rounded-full bg-paper/70 text-ink transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** `/groups` ("Moje grupy"): the groups the caller leads, with links to
 * adding and editing them (own pages) and deleting them. Their terms stay on `/meetings`. */
export function GroupsView() {
  const { myGroups, terms, load, showToast } = useAppData();
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<GroupResponse | null>(null);
  const deleteFailedRef = useRef(false);

  /** Rejects with the message `DeleteGroupDialog` shows inline. */
  async function confirmDeleteGroup(groupId: string) {
    try {
      await deleteGroup(groupId);
    } catch (err) {
      deleteFailedRef.current = true;
      throw new Error(serverMessageOr(err, "Nie udało się usunąć grupy. Spróbuj ponownie."));
    }
    deleteFailedRef.current = false;
    showToast("Usunięto grupę");
    await load({ silent: true });
    setPendingDeleteGroup(null);
  }

  /** After a failed attempt the group may already be gone (404/403), so re-read. */
  function closeDeleteDialog() {
    setPendingDeleteGroup(null);
    if (deleteFailedRef.current) {
      deleteFailedRef.current = false;
      void load({ silent: true });
    }
  }

  const hasGroups = myGroups.length > 0;
  return (
    <>
      <SubPageHeader title="Moje grupy" backTo={viewPath("meetings")} backLabel="Wróć do spotkań" />
      <section>
        <div className="mb-2.5 flex items-center justify-between gap-2.5">
          <div className="flex items-baseline gap-1.5">
            <h2 className={SECTION_TITLE}>Prowadzę</h2>
            <span className={SECTION_COUNT}>· {myGroups.length}</span>
          </div>
          <Link to={viewPath("groups/new")} className={ADD_BUTTON}>
            {hasGroups ? "+ Dodaj grupę" : "+ Załóż grupę"}
          </Link>
        </div>
        {!hasGroups ? (
          <div className={EMPTY}>Nie masz jeszcze żadnej grupy. Załóż pierwszą, żeby dodać termin.</div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {myGroups.map((g, index) => {
              const termCount = terms.filter((t) => t.group.id === g.id).length;
              return (
                <div
                  key={g.id}
                  className={`flex min-h-36 flex-col justify-between gap-3 rounded-[22px] p-3.5 ${GROUP_TONES[index % 2]}`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <Link
                      to={groupEditPath(g.id)}
                      aria-label={`Zmień układ grupy ${g.name} (${LAYOUT_LABEL[g.layout_mode]})`}
                      title={`Układ: ${LAYOUT_LABEL[g.layout_mode]}`}
                      className={`flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${GROUP_ICON_TONES[index % 2]}`}
                    >
                      <LayoutModeIcon mode={g.layout_mode} />
                    </Link>
                    <div className="flex gap-1">
                      <Link to={groupEditPath(g.id)} aria-label={`Edytuj grupę ${g.name}`} className={TILE_BUTTON}>
                        <PencilIcon />
                      </Link>
                      <button
                        type="button"
                        onClick={(event) => {
                          // Safari does not focus a clicked button; the dialog
                          // captures the focused element as its opener.
                          event.currentTarget.focus();
                          setPendingDeleteGroup(g);
                        }}
                        aria-label={`Usuń grupę ${g.name}`}
                        aria-haspopup="dialog"
                        className={`${TILE_BUTTON} hover:text-danger`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-extrabold wrap-break-word text-ink">{g.name}</h3>
                    <small className="block text-[13px] text-ink-soft">
                      {g.default_location?.name ?? `${termCount} ${pluralPl(termCount, "termin", "terminy", "terminów")}`}
                    </small>
                    {g.default_location && (
                      <small className="block truncate text-xs text-ink-soft">{g.default_location.formatted_address}</small>
                    )}
                    <Link
                      to={`/groups/${g.id}`}
                      className="mt-1.5 inline-block rounded text-[13px] font-bold text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      Szczegóły<span className="sr-only"> grupy {g.name}</span> ›
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {pendingDeleteGroup && (
        <DeleteGroupDialog
          group={pendingDeleteGroup}
          onConfirm={() => confirmDeleteGroup(pendingDeleteGroup.id)}
          onClose={closeDeleteDialog}
        />
      )}
    </>
  );
}
