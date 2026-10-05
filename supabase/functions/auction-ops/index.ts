import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { action } = body;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // --- PLACE BID ---
    if (action === "place_bid") {
      const { listing_id, bid_amount } = body;
      if (!listing_id || !bid_amount) {
        return new Response(
          JSON.stringify({ error: "listing_id and bid_amount are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: result, error: bidError } = await userClient.rpc("place_bid", {
        p_listing_id: listing_id,
        p_bidder_id: userData.user.id,
        p_bid_amount: Number(bid_amount),
      });

      if (bidError) {
        return new Response(
          JSON.stringify({ error: bidError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const row = result && result[0];
      return new Response(
        JSON.stringify({
          success: row?.success ?? false,
          min_next_bid: row?.min_next_bid ?? null,
          message: row?.message ?? "No response",
          new_current_bid: row?.new_current_bid ?? null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- REFRESH DUTCH PRICES ---
    if (action === "refresh_dutch_prices") {
      const { data: count, error: refreshError } = await userClient.rpc("refresh_dutch_prices");
      if (refreshError) {
        return new Response(
          JSON.stringify({ error: refreshError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ refreshed: count }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- CLAIM DUTCH AUCTION ITEM ---
    if (action === "claim_dutch") {
      const { listing_id } = body;
      if (!listing_id) {
        return new Response(
          JSON.stringify({ error: "listing_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Atomically claim: set status to sold if still active
      const { data: listing, error: listingError } = await adminClient
        .from("listings")
        .select("*")
        .eq("id", listing_id)
        .eq("status", "active")
        .eq("auction_mode", "DUTCH")
        .maybeSingle();

      if (listingError || !listing) {
        return new Response(
          JSON.stringify({ error: "Listing not available for claim" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const claimPrice = Number(listing.current_dutch_price ?? listing.auction_start_price);

      // Create order
      const { error: orderError } = await adminClient.from("orders").insert({
        buyer_id: userData.user.id,
        listing_id: listing_id,
        boutique_id: listing.boutique_id,
        amount: claimPrice,
        status: "escrow_held",
        shipping_address: "Pending - Cebu pickup/delivery",
      });

      if (orderError) {
        return new Response(
          JSON.stringify({ error: "Failed to create order: " + orderError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Mark listing as sold
      await adminClient.from("listings")
        .update({ status: "sold" })
        .eq("id", listing_id);

      return new Response(
        JSON.stringify({
          success: true,
          claim_price: claimPrice,
          message: "Dutch auction item claimed successfully",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- VALIDATE CEBU GEOFENCE ---
    if (action === "validate_geofence") {
      const { lat, lng } = body;
      if (lat === undefined || lng === undefined) {
        return new Response(
          JSON.stringify({ error: "lat and lng are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Cebu bounding box
      const cebuLatMin = 9.25;
      const cebuLatMax = 11.00;
      const cebuLngMin = 123.20;
      const cebuLngMax = 124.70;

      const withinCebu =
        lat >= cebuLatMin && lat <= cebuLatMax &&
        lng >= cebuLngMin && lng <= cebuLngMax;

      // Find nearest barangay
      let nearestBarangay = null;
      if (withinCebu) {
        const { data: barangays } = await adminClient
          .from("cebu_barangays")
          .select("name, city_municipality, lat, lng, is_metro_cebu")
          .order("is_metro_cebu", { ascending: false });

        if (barangays && barangays.length > 0) {
          let minDist = Infinity;
          for (const b of barangays) {
            const dist = Math.sqrt(
              Math.pow(b.lat - lat, 2) + Math.pow(b.lng - lng, 2),
            );
            if (dist < minDist) {
              minDist = dist;
              nearestBarangay = b;
            }
          }
        }
      }

      return new Response(
        JSON.stringify({
          within_cebu: withinCebu,
          nearest_barangay: nearestBarangay,
          message: withinCebu
            ? "Location is within Cebu"
            : "Location is outside Cebu. Only Cebu-based addresses are supported.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- GET CEBU BARANGAYS ---
    if (action === "get_barangays") {
      const { data: barangays, error: bError } = await adminClient
        .from("cebu_barangays")
        .select("name, city_municipality, lat, lng, is_metro_cebu")
        .order("city_municipality")
        .order("name");

      if (bError) {
        return new Response(
          JSON.stringify({ error: bError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ barangays }),
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
