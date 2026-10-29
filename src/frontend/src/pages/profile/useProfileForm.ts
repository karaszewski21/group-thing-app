import { useState } from "react";
import { deleteMyAvatar, updateMyProfile, uploadMyAvatar } from "../../api/people";
import { serverMessageOr } from "../../api/problem";
import { useAppData } from "../../app/appDataStore";

/** "Dane profilowe" on /profile: name and bio edited locally (seeded from the
 * loaded profile when the page opens), the avatar uploaded or removed at once.
 * Every save writes the result back to the panel's `profile`, which the
 * header and Start also show. */
export function useProfileForm() {
  const { profile, setProfile, showToast } = useAppData();
  const [name, setName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      const updated = await updateMyProfile({ display_name: name, bio: bio.trim() || null });
      setProfile(updated);
      setName(updated.display_name);
      setBio(updated.bio ?? "");
      setSaved(true);
      showToast("Zapisano dane profilowe");
      setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(serverMessageOr(err, "Nie udało się zapisać profilu — spróbuj ponownie"));
    }
  }

  async function changeAvatar(file: File) {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const avatar = await uploadMyAvatar(file);
      setProfile((current) => (current ? { ...current, avatar } : current));
      showToast(avatar.status === "APPROVED" ? "Zapisano zdjęcie profilowe" : "Zdjęcie czeka na moderację");
    } catch (err) {
      setAvatarError(serverMessageOr(err, "Nie udało się wgrać zdjęcia — spróbuj ponownie"));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      await deleteMyAvatar();
      setProfile((current) => (current ? { ...current, avatar: null } : current));
      showToast("Usunięto zdjęcie profilowe");
    } catch (err) {
      setAvatarError(serverMessageOr(err, "Nie udało się usunąć zdjęcia — spróbuj ponownie"));
    } finally {
      setAvatarBusy(false);
    }
  }

  return { name, setName, bio, setBio, saved, error, avatarBusy, avatarError, save, changeAvatar, removeAvatar };
}
