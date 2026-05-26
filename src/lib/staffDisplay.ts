type StaffLike =
  | {
      full_name?: string | null;
      username?: string | null;
    }
  | null
  | undefined;

export function staffDisplay(staff: StaffLike) {
  const fullName = staff?.full_name?.trim() ?? "";
  if (fullName && !fullName.includes("@")) return fullName;

  const username = staff?.username?.trim() ?? "";
  if (!username) return fullName.includes("@") ? fullName.split("@")[0] : fullName;

  return username.includes("@") ? username.split("@")[0] : username;
}
