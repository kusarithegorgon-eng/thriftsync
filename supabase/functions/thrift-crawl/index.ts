import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TRANSPORT_SPEEDS: Record<string, number> = {
  walking: 5,
  driving: 25,
  jeepney: 15,
};

const TRANSFER_OVERHEAD: Record<string, number> = {
  walking: 0,
  driving: 3,
  jeepney: 8,
};

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json();
    const { action } = body;

    // --- OPTIMIZE ROUTE ---
    if (action === "optimize_route") {
      const { stops, transport_mode } = body;
      if (!stops || !Array.isArray(stops) || stops.length === 0) {
        return new Response(
          JSON.stringify({ error: "stops array is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const mode = transport_mode || "driving";
      const speed = TRANSPORT_SPEEDS[mode] || 25;
      const overhead = TRANSFER_OVERHEAD[mode] || 3;

      // Nearest-neighbor greedy optimization
      const unvisited = [...stops];
      const ordered: any[] = [];
      const segments: any[] = [];
      let totalDist = 0;
      let totalTime = 0;

      let current = unvisited.shift();
      current.stop_order = 1;
      ordered.push(current);

      while (unvisited.length > 0) {
        let nearestIdx = 0;
        let nearestDist = Infinity;

        for (let i = 0; i < unvisited.length; i++) {
          const dist = haversineDistance(
            current.lat, current.lng,
            unvisited[i].lat, unvisited[i].lng,
          );
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestIdx = i;
          }
        }

        const next = unvisited.splice(nearestIdx, 1)[0];
        next.stop_order = ordered.length + 1;
        ordered.push(next);

        const segTime = (nearestDist / speed) * 60 + overhead;
        segments.push({
          from_lat: current.lat,
          from_lng: current.lng,
          to_lat: next.lat,
          to_lng: next.lng,
          distance_km: nearestDist,
          time_minutes: segTime,
        });

        totalDist += nearestDist;
        totalTime += segTime;
        current = next;
      }

      return new Response(
        JSON.stringify({
          ordered_stops: ordered,
          segments,
          total_distance_km: totalDist,
          total_time_minutes: Math.round(totalTime),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- SAVE ITINERARY ---
    if (action === "save_itinerary") {
      const { name, stops, transport_mode, scheduled_date } = body;
      if (!name || !stops) {
        return new Response(
          JSON.stringify({ error: "name and stops are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData.user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Calculate route
      const mode = transport_mode || "driving";
      const speed = TRANSPORT_SPEEDS[mode] || 25;
      const overhead = TRANSFER_OVERHEAD[mode] || 3;
      let totalDist = 0;
      let totalTime = 0;
      for (let i = 0; i < stops.length - 1; i++) {
        const dist = haversineDistance(stops[i].lat, stops[i].lng, stops[i + 1].lat, stops[i + 1].lng);
        totalDist += dist;
        totalTime += (dist / speed) * 60 + overhead;
      }

      const { data, error: insertError } = await userClient.from("itineraries").insert({
        user_id: userData.user.id,
        name,
        stops,
        transport_mode: mode,
        total_distance_km: totalDist,
        total_time_minutes: Math.round(totalTime),
        scheduled_date: scheduled_date || null,
        status: "planned",
      }).select().maybeSingle();

      if (insertError) {
        return new Response(
          JSON.stringify({ error: insertError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ success: true, itinerary: data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- GET DISTRICTS ---
    if (action === "get_districts") {
      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data, error: distError } = await adminClient
        .from("cebu_districts")
        .select("*")
        .order("city_municipality")
        .order("name");

      if (distError) {
        return new Response(
          JSON.stringify({ error: distError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ districts: data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- GET LOCKERS ---
    if (action === "get_lockers") {
      const { district_id } = body;
      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      let query = adminClient
        .from("locker_locations")
        .select("*")
        .eq("is_active", true);

      if (district_id) {
        query = query.eq("district_id", district_id);
      }

      const { data, error: lockerError } = await query.order("partner_name");

      if (lockerError) {
        return new Response(
          JSON.stringify({ error: lockerError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ lockers: data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- GENERATE HANDOFF PIN ---
    if (action === "generate_pin") {
      const { locker_location_id, order_id } = body;
      if (!locker_location_id) {
        return new Response(
          JSON.stringify({ error: "locker_location_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data, error: pinError } = await userClient.rpc("generate_handoff_pin", {
        p_locker_location_id: locker_location_id,
        p_order_id: order_id || null,
      });

      if (pinError) {
        return new Response(
          JSON.stringify({ error: pinError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const row = data && data[0];
      return new Response(
        JSON.stringify({
          handoff_id: row?.handoff_id,
          pin_code: row?.pin_code,
          locker_name: row?.locker_name,
          expires_at: row?.expires_at,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- CONFIRM PICKUP ---
    if (action === "confirm_pickup") {
      const { handoff_id, pin_code } = body;
      if (!handoff_id || !pin_code) {
        return new Response(
          JSON.stringify({ error: "handoff_id and pin_code are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data, error: confirmError } = await userClient.rpc("confirm_handoff_pickup", {
        p_handoff_id: handoff_id,
        p_pin_code: pin_code,
      });

      if (confirmError) {
        return new Response(
          JSON.stringify({ error: confirmError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const row = data && data[0];
      return new Response(
        JSON.stringify({
          success: row?.success ?? false,
          message: row?.message ?? "Unknown result",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- MARK DROPPED OFF ---
    if (action === "mark_dropped_off") {
      const { handoff_id, pin_code } = body;
      if (!handoff_id || !pin_code) {
        return new Response(
          JSON.stringify({ error: "handoff_id and pin_code are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data, error: dropError } = await userClient.rpc("mark_dropped_off", {
        p_handoff_id: handoff_id,
        p_pin_code: pin_code,
      });

      if (dropError) {
        return new Response(
          JSON.stringify({ error: dropError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const row = data && data[0];
      return new Response(
        JSON.stringify({
          success: row?.success ?? false,
          message: row?.message ?? "Unknown result",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action: " + action }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
