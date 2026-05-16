import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BootstrapInput = {
  email?: string;
  password?: string;
  fullName?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanUsername(email: string) {
  const base = email.split("@")[0] || "admin";
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return cleaned.length >= 3 ? cleaned : "admin";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase Edge Function secrets are missing" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    const body = (await request.json()) as BootstrapInput;
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";
    const fullName = body.fullName?.trim() || email;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "A valid email is required" }, 400);
    }

    if (password.length < 6) {
      return jsonResponse({ error: "Password must be at least 6 characters" }, 400);
    }

    const { count: existingRoles, error: countError } = await admin
      .from("user_roles")
      .select("id", { count: "exact", head: true });

    if (countError) throw countError;
    if ((existingRoles ?? 0) > 0) {
      return jsonResponse({ error: "First admin has already been created" }, 409);
    }

    const username = cleanUsername(email);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        full_name: fullName,
      },
    });

    if (createError) throw createError;

    const userId = created.user?.id;
    if (!userId) {
      return jsonResponse({ error: "Supabase Auth did not return the created user" }, 500);
    }

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: userId,
        username,
        full_name: fullName,
        email,
        active: true,
      },
      { onConflict: "id" },
    );

    if (profileError) {
      await admin.auth.admin.deleteUser(userId);
      throw profileError;
    }

    const { error: roleError } = await admin.rpc("bootstrap_first_admin", {
      _user_id: userId,
    });

    if (roleError) {
      await admin.auth.admin.deleteUser(userId);
      throw roleError;
    }

    return jsonResponse({ userId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the first admin";
    return jsonResponse({ error: message }, 400);
  }
});
