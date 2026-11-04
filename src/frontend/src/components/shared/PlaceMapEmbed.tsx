import { buildMapsEmbedUrl } from "../../lib/googleMaps";

/** A read-only Google map pinning `query`; nothing without a Maps key. */
export function PlaceMapEmbed({ query, zoom, title }: { query: string; zoom: number; title: string }) {
  const src = buildMapsEmbedUrl(query, zoom);
  if (!src) return null;
  return (
    <iframe
      src={src}
      title={title}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className="mt-2.5 block h-44 w-full rounded-xl border-0 bg-cream"
    />
  );
}
