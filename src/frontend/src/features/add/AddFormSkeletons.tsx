import type { ReactNode } from "react";
import { Skeleton } from "../../components/shared/Skeleton";

/** The forms under /add while they load, each in its own fields' shape. */

function Busy({ children }: { children: ReactNode }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">Wczytywanie…</span>
      {children}
    </div>
  );
}

/** The white form card the item, event and term forms sit in. */
function FormCard({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-[22px] border border-line bg-paper p-5">{children}</div>;
}

/** A label over an input; `tall` for a textarea. */
function FieldSkeleton({ label = "w-20", tall = false }: { label?: string; tall?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className={`h-3 rounded-md ${label}`} />
      <Skeleton className={`w-full rounded-xl ${tall ? "h-24" : "h-11"}`} />
    </div>
  );
}

function ButtonSkeleton({ className = "" }: { className?: string }) {
  return <Skeleton className={`h-11 w-full rounded-[13px] ${className}`} />;
}

/** `/add/product`: photos, name, condition, category, description, points,
 * place, then Oddam / Zamienię and the draft button. */
export function ItemFormSkeleton() {
  return (
    <Busy>
      <FormCard>
        <Skeleton className="h-3 w-24 rounded-md" />
        <Skeleton className="-mt-1 aspect-4/3 w-full rounded-2xl" />
        <FieldSkeleton label="w-14" />
        <FieldSkeleton label="w-10" />
        <FieldSkeleton label="w-20" />
        <FieldSkeleton label="w-10" tall />
        <Skeleton className="h-4 w-40 rounded-md" />
        <FieldSkeleton label="w-24" />
        <div className="mt-1 grid grid-cols-2 gap-2">
          <ButtonSkeleton />
          <ButtonSkeleton />
          <ButtonSkeleton className="col-span-2" />
        </div>
      </FormCard>
    </Busy>
  );
}

/** `/add/event`: banner, name, start date and hour, end hour, place,
 * description and the save button. */
export function EventFormSkeleton() {
  return (
    <Busy>
      <FormCard>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="aspect-video w-full rounded-2xl" />
          <Skeleton className="h-2.5 w-36 rounded-md" />
        </div>
        <FieldSkeleton label="w-14" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-18 rounded-md" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
          </div>
        </div>
        <FieldSkeleton label="w-28" />
        <FieldSkeleton label="w-16" />
        <FieldSkeleton label="w-10" tall />
        <ButtonSkeleton className="mt-1" />
      </FormCard>
    </Busy>
  );
}

/** `/add/term`: group, date and hour, description, place, capacity, price,
 * the needed-items button and the save button. */
export function TermFormSkeleton() {
  return (
    <Busy>
      <FormCard>
        <FieldSkeleton label="w-12" />
        <FieldSkeleton label="w-28" />
        <FieldSkeleton label="w-32" />
        <FieldSkeleton label="w-16" />
        <FieldSkeleton label="w-20" />
        <FieldSkeleton label="w-16" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-44 rounded-md" />
          <Skeleton className="h-7 w-36 rounded-full" />
        </div>
        <ButtonSkeleton className="mt-1" />
      </FormCard>
    </Busy>
  );
}

/** `/add/wanted`: the back link, title and intro, the name field with its
 * count, the closed "refine" disclosure and the save button. */
export function WantFormSkeleton() {
  return (
    <Busy>
      <div className="flex flex-col">
        <Skeleton className="h-4 w-24 rounded-md" />
        <Skeleton className="mt-3.5 h-9 w-56 rounded-xl" />
        <Skeleton className="mt-2 h-3.5 w-full rounded-md" />
        <Skeleton className="mt-1.5 h-3.5 w-2/3 rounded-md" />
        <div className="mt-3.5 flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-28 rounded-md" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-2.5 w-20 rounded-md" />
          </div>
          <Skeleton className="h-12 w-full rounded-2xl" />
          <Skeleton className="h-12 w-full rounded-[13px]" />
        </div>
      </div>
    </Busy>
  );
}
