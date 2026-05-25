import { supabase } from "@/services/repositories/supabaseClient";
import { raiseIfError, toAppError } from "@/services/repositories/supabaseErrors";
import type { AuthSession, AuthUser, Role, UserProfile } from "@/types/domain";

type ProfileWithRoles = {
  id: string;
  username: string;
  full_name: string;
  email: string;
  active: boolean;
  created_at: string;
  user_roles?: Array<{ role: Role }>;
};

function toAuthUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): AuthUser {
  return {
    id: user.id,
    email: user.email ?? "",
    user_metadata: {
      username: String(user.user_metadata?.username ?? ""),
      full_name: String(user.user_metadata?.full_name ?? ""),
    },
  };
}

function toSession(session: {
  access_token: string;
  user: Parameters<typeof toAuthUser>[0];
}): AuthSession {
  return {
    access_token: session.access_token,
    user: toAuthUser(session.user),
  };
}

function toProfile(row: ProfileWithRoles): UserProfile {
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    email: row.email,
    active: row.active,
    created_at: row.created_at,
    roles: row.user_roles?.map((role) => role.role) ?? [],
  };
}

async function getProfileById(userId: string | undefined) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, email, active, created_at, user_roles(role)")
    .eq("id", userId)
    .eq("active", true)
    .maybeSingle();

  raiseIfError(error, "Could not load Supabase profile");
  return data ? toProfile(data as ProfileWithRoles) : null;
}

async function restoreSession(accessToken?: string, refreshToken?: string) {
  if (!accessToken || !refreshToken) return;
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  raiseIfError(error, "Could not restore admin session");
}

export const authService = {
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    raiseIfError(error, "Could not load Supabase session");
    return data.session ? toSession(data.session) : null;
  },

  onSessionChange(callback: (session: AuthSession | null) => void) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session ? toSession(session) : null);
    });
    return () => data.subscription.unsubscribe();
  },

  async getCurrentProfile() {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return getProfileById(data.user.id);
  },

  async signInWithEmail(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    raiseIfError(error, "Invalid Supabase email or password");
    if (!data.session) throw new Error("Supabase did not return a session");
    return toSession(data.session);
  },

  async signInWithPin(username: string, pin: string) {
    const email = `${username.trim().toLowerCase()}@jungle.local`;
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: `pin-${pin}`,
    });
    raiseIfError(error, "Invalid Supabase username or PIN");
    if (!data.session) throw new Error("Supabase did not return a session");
    return toSession(data.session);
  },

  async verifyCurrentCredential(passwordOrPin: string) {
    const credential = passwordOrPin.trim();
    if (!credential) throw new Error("Approval password or PIN is required");

    const { data: current, error: sessionError } = await supabase.auth.getSession();
    raiseIfError(sessionError, "Could not verify current staff session");

    const email = current.session?.user.email;
    if (!email) throw new Error("Current staff account has no email to verify");

    const attempts = credential.startsWith("pin-")
      ? [credential]
      : [credential, `pin-${credential}`];
    for (const password of attempts) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (!error && data.session) return toSession(data.session);
    }

    throw new Error("Invalid approval password or PIN");
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    raiseIfError(error, "Could not sign out");
  },

  async listUsers() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, full_name, email, active, created_at, user_roles(role)")
      .order("created_at", { ascending: false });

    raiseIfError(error, "Could not load users");
    return ((data ?? []) as ProfileWithRoles[]).map(toProfile);
  },

  async createUser(input: {
    username: string;
    fullName: string;
    email?: string;
    password?: string;
    pin?: string;
    role: Role;
  }) {
    const username = input.username.trim().toLowerCase();
    const email = (input.email || `${username}@jungle.local`).trim().toLowerCase();
    const password = input.password || (input.pin ? `pin-${input.pin}` : undefined);
    if (!password) throw new Error("Password or PIN is required for Supabase Auth");

    const current = await supabase.auth.getSession();
    raiseIfError(current.error, "Could not preserve admin session");
    const adminAccessToken = current.data.session?.access_token;
    const adminRefreshToken = current.data.session?.refresh_token;

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          full_name: input.fullName.trim() || username,
        },
      },
    });
    raiseIfError(signUpError, "Could not create Supabase Auth user");

    await restoreSession(adminAccessToken, adminRefreshToken);

    const userId = signUpData.user?.id;
    if (!userId) throw new Error("Supabase Auth did not return the created user");

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        id: userId,
        username,
        full_name: input.fullName.trim() || username,
        email,
        active: true,
      },
      { onConflict: "id" },
    );
    raiseIfError(profileError, "Could not save staff profile");

    const { error: roleError } = await supabase
      .from("user_roles")
      .upsert({ user_id: userId, role: input.role }, { onConflict: "user_id,role" });
    raiseIfError(roleError, "Could not assign staff role");

    const profile = await getProfileById(userId);
    if (!profile) throw new Error("Created user profile is not readable");
    return profile;
  },

  async createFirstAdmin(input: { email: string; password: string; fullName: string }) {
    try {
      const email = input.email.trim().toLowerCase();
      const fullName = input.fullName.trim() || email;

      const { error } = await supabase.functions.invoke("bootstrap-first-admin", {
        body: {
          email,
          password: input.password,
          fullName,
        },
      });

      if (error) {
        let message = error.message;
        const context = "context" in error ? error.context : null;
        if (context instanceof Response) {
          const payload = (await context.json().catch(() => null)) as { error?: string } | null;
          message = payload?.error ?? message;
        }
        throw new Error(message);
      }

      const session = await this.signInWithEmail(email, input.password);
      const profile = await getProfileById(session.user.id);
      if (!profile) throw new Error("First admin profile is not readable");
      return profile;
    } catch (error) {
      throw toAppError(
        error,
        "Could not create the first admin. Check the bootstrap-first-admin Edge Function deployment.",
      );
    }
  },
};
