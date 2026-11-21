import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Use POST to invite a driver." });
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "Sign in as the seller to invite a driver." });
  }

  let payload: { email?: unknown; displayName?: unknown };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { error: "The invitation details are not valid JSON." });
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const displayName = typeof payload.displayName === "string" ? payload.displayName.trim() : "";
  if (
    email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || displayName.length < 2
    || displayName.length > 80
  ) {
    return jsonResponse(400, { error: "Enter a valid driver name and email address." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appUrlValue = Deno.env.get("APP_URL");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !appUrlValue) {
    return jsonResponse(500, { error: "The driver invitation service is not configured." });
  }

  let redirectTo: string;
  try {
    const appUrl = new URL(appUrlValue);
    if (
      !["https:", "http:"].includes(appUrl.protocol)
      || (appUrl.protocol === "http:" && !["localhost", "127.0.0.1"].includes(appUrl.hostname))
    ) {
      return jsonResponse(500, { error: "Configure APP_URL with HTTPS, or localhost for development." });
    }
    redirectTo = new URL("/", appUrl).toString();
  } catch {
    return jsonResponse(500, { error: "Configure APP_URL as the frontend base URL." });
  }

  const requestClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await requestClient.auth.getUser();
  if (authError || !authData.user) {
    return jsonResponse(401, { error: "Your session is not valid. Sign in again." });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: account, error: accountError } = await adminClient
    .from("profiles")
    .select("id")
    .eq("id", authData.user.id)
    .in("role", ["buyer", "seller"])
    .eq("account_status", "active")
    .maybeSingle();
  if (accountError) {
    console.error("Could not verify account for driver invitation:", accountError.message);
    return jsonResponse(500, { error: "Could not verify your account." });
  }
  if (!account) {
    return jsonResponse(403, { error: "Only an active marketplace account can invite a driver." });
  }

  const { data: boutique, error: boutiqueError } = await adminClient
    .from("boutiques")
    .select("id")
    .eq("seller_id", account.id)
    .limit(1)
    .maybeSingle();
  if (boutiqueError) {
    console.error("Could not verify seller boutique for driver invitation:", boutiqueError.message);
    return jsonResponse(500, { error: "Could not verify your boutique." });
  }
  if (!boutique) {
    return jsonResponse(403, { error: "Create a boutique before inviting a driver." });
  }

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName, courier_setup_required: true },
    redirectTo,
  });
  if (inviteError || !inviteData.user) {
    if (inviteError) console.error("Could not invite courier:", inviteError.message);
    return jsonResponse(400, {
      error: "Could not send the invitation. If this email already has an account, link its active courier account instead.",
    });
  }

  const courierId = inviteData.user.id;
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .update({ role: "courier" })
    .eq("id", courierId)
    .select("id")
    .maybeSingle();
  if (profileError || !profile) {
    if (profileError) console.error("Could not set invited profile to courier:", profileError.message);
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(courierId);
    if (cleanupError) console.error("Could not clean up incomplete courier invite:", cleanupError.message);
    return jsonResponse(500, { error: "The driver account could not be prepared. Please retry." });
  }

  const { error: linkError } = await adminClient
    .from("seller_couriers")
    .insert({ seller_id: seller.id, courier_id: courierId });
  if (linkError) {
    console.error("Could not link invited courier to seller:", linkError.message);
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(courierId);
    if (cleanupError) console.error("Could not clean up incomplete courier invite:", cleanupError.message);
    return jsonResponse(500, { error: "The driver could not be linked to your boutique. Please retry." });
  }

  return jsonResponse(200, {
    message: `Invitation sent to ${email}. They need to open the email and set their password before accepting deliveries.`,
  });
});
