"use client";

import { SafeImage } from "../../product/ItemGallery";
import { usePartyProfilePage } from "../PartyProfileContext";

/** The person's approved gallery photos under the bio; nothing without any. */
export function ProfileGallery() {
  const { gallery } = usePartyProfilePage().profile;
  if (gallery.length === 0) return null;
  return (
    <section aria-label="Galeria" className="px-6">
      <ul className="grid grid-cols-3 gap-2">
        {gallery.map((photo) => (
          <li key={photo.url}>
            <a href={photo.url} target="_blank" rel="noreferrer" className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
              <SafeImage src={photo.thumb_url} alt="Zdjęcie z galerii" className="aspect-square w-full rounded-xl object-cover" placeholderSize={20} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
