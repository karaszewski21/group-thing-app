/** The organizer's initial in a primary disc, ringed like the mockup's center. */
export function OrganizerAvatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <div
      className={`mx-auto flex items-center justify-center rounded-full bg-primary font-serif font-extrabold text-on-primary shadow-[0_0_0_5px_var(--color-primary-soft),0_0_0_7px_var(--color-primary)] ${small ? "h-13 w-13 text-xl" : "h-20 w-20 text-3xl"}`}
    >
      {name ? name.slice(0, 1).toUpperCase() : "?"}
    </div>
  );
}
