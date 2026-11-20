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
  motorbike: 25,
  jeepney: 15,
};

const TRANSFER_OVERHEAD: Record<string, number> = {
  walking: 0,
  driving: 3,
  motorbike: 3,
  jeepney: 8,
};

type CrawlPoint = { lat: number; lng: number };
type CrawlStop = CrawlPoint & {
  boutique_id?: string;
  boutique_name?: string;
  operating_hours?: Record<string, string>;
};
type ValhallaLeg = { summary: { length: number; time: number }; shape: string };
type ValhallaResponse = {
  trip?: { status?: number; status_message?: string; legs?: ValhallaLeg[] };
};

function decodePolyline(encoded: string, precision: number): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    const deltas: number[] = [];
    for (let coordinate = 0; coordinate < 2; coordinate += 1) {
      let result = 0;
      let shift = 0;
      let chunk: number;
      do {
        if (index >= encoded.length || shift > 30) {
          throw new Error("Routing service returned an invalid polyline.");
        }
        chunk = encoded.charCodeAt(index++) - 63;
        if (chunk < 0 || chunk > 63) {
          throw new Error("Routing service returned an invalid polyline.");
        }
        result |= (chunk & 0x1f) << shift;
        shift += 5;
      } while (chunk >= 0x20);
      deltas.push((result & 1) ? ~(result >> 1) : result >> 1);
    }
    lat += deltas[0];
    lng += deltas[1];
    coordinates.push([lat / 10 ** precision, lng / 10 ** precision]);
  }
  return coordinates;
}

function googleDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return match ? Number(match[1]) : null;
}

function isCrawlPoint(value: unknown): value is CrawlPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.lat === "number" && Number.isFinite(point.lat)
    && typeof point.lng === "number" && Number.isFinite(point.lng);
}

function isCrawlStop(value: unknown): value is CrawlStop {
  if (!isCrawlPoint(value)) return false;
  const stop = value as CrawlStop & { operating_hours?: unknown };
  if (stop.operating_hours === undefined) return true;
  if (!stop.operating_hours || typeof stop.operating_hours !== "object" || Array.isArray(stop.operating_hours)) return false;
  return Object.values(stop.operating_hours).every((hours) => typeof hours === "string");
}

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
      if (!Object.hasOwn(TRANSPORT_SPEEDS, mode)) {
        return new Response(
          JSON.stringify({ error: "transport_mode must be walking, driving, motorbike, or jeepney" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const speed = TRANSPORT_SPEEDS[mode];
      const overhead = TRANSFER_OVERHEAD[mode];

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

    // --- ESTIMATE CEBU CRAWL ARRIVALS ---
    if (action === "estimate_eta") {
      const stopsInput: unknown = body.stops;
      const startLocationInput: unknown = body.start_location;
      const mode = typeof body.transport_mode === "string" ? body.transport_mode : "driving";
      const departure = new Date(body.departure_at);
      if (!Array.isArray(stopsInput) || stopsInput.length === 0 || stopsInput.length > 20) {
        return new Response(
          JSON.stringify({ error: "Provide between one and twenty route stops" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const stops = stopsInput.filter(isCrawlStop);
      if (stops.length !== stopsInput.length) {
        return new Response(
          JSON.stringify({ error: "Every route stop must have valid coordinates and operating hours" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (startLocationInput !== undefined && startLocationInput !== null && !isCrawlPoint(startLocationInput)) {
        return new Response(
          JSON.stringify({ error: "start_location must contain valid coordinates" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const startLocation = isCrawlPoint(startLocationInput) ? startLocationInput : null;
      if (!Object.hasOwn(TRANSPORT_SPEEDS, mode) || Number.isNaN(departure.getTime())) {
        return new Response(
          JSON.stringify({ error: "A valid transport mode and departure_at timestamp are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const points: CrawlPoint[] = startLocation ? [startLocation, ...stops] : stops;
      if (points.some((point) =>
        !Number.isFinite(point.lat) || !Number.isFinite(point.lng)
        || point.lat < 9.25 || point.lat > 11 || point.lng < 123.2 || point.lng > 124.7
      )) {
        return new Response(
          JSON.stringify({ error: "Route coordinates must be valid locations within Cebu" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const googleRoutesApiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
      if (googleRoutesApiKey) {
        const origin = startLocation || stops[0];
        const destination = stops[stops.length - 1];
        const intermediateStops = startLocation
          ? stops.slice(0, -1)
          : stops.slice(1, -1);
        const travelMode = mode === "walking"
          ? "WALK"
          : mode === "motorbike"
            ? "TWO_WHEELER"
            : "DRIVE";
        const routeRequest: Record<string, unknown> = {
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
          intermediates: intermediateStops.map((stop) => ({
            location: { latLng: { latitude: stop.lat, longitude: stop.lng } },
          })),
          travelMode,
        };
        if (travelMode === "DRIVE" || travelMode === "TWO_WHEELER") {
          routeRequest.routingPreference = "TRAFFIC_UNAWARE";
        }
        if (intermediateStops.length > 1) {
          routeRequest.optimizeWaypointOrder = true;
        }

        let googleResponse: Response;
        try {
          googleResponse = await fetch(
            "https://routes.googleapis.com/directions/v2:computeRoutes",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": googleRoutesApiKey,
                "X-Goog-FieldMask": [
                  "routes.duration",
                  "routes.distanceMeters",
                  "routes.polyline.encodedPolyline",
                  "routes.legs.duration",
                  "routes.legs.distanceMeters",
                  "routes.optimizedIntermediateWaypointIndex",
                ].join(","),
              },
              body: JSON.stringify(routeRequest),
              signal: AbortSignal.timeout(15000),
            },
          );
        } catch (error) {
          return new Response(
            JSON.stringify({
              error: `Google Routes API request failed: ${error instanceof Error ? error.message : "network error"}`,
            }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const googleResult = await googleResponse.json();
        if (!googleResponse.ok) {
          const apiMessage = googleResult?.error?.message;
          return new Response(
            JSON.stringify({
              error: typeof apiMessage === "string"
                ? `Google Routes API returned ${googleResponse.status}: ${apiMessage}`
                : `Google Routes API returned ${googleResponse.status}. Check the key, billing, and Routes API settings.`,
            }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const route = googleResult?.routes?.[0];
        const legs = route?.legs;
        const routeCoordinates = typeof route?.polyline?.encodedPolyline === "string"
          ? decodePolyline(route.polyline.encodedPolyline, 5)
          : [];
        const expectedLegCount = points.length - 1;
        if (
          !Array.isArray(legs) ||
          legs.length !== expectedLegCount ||
          routeCoordinates.length < 2 ||
          !Number.isFinite(route.distanceMeters) ||
          !legs.every((leg: { distanceMeters?: number; duration?: string }) =>
            Number.isFinite(leg.distanceMeters) && googleDurationSeconds(leg.duration) !== null
          )
        ) {
          return new Response(
            JSON.stringify({ error: "Google Routes returned an incomplete route. Check the Routes API response field access." }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        let routedStops = [...stops];
        if (intermediateStops.length > 1) {
          const optimizedIndexes = route.optimizedIntermediateWaypointIndex;
          if (
            !Array.isArray(optimizedIndexes) ||
            optimizedIndexes.length !== intermediateStops.length ||
            optimizedIndexes.some((waypointIndex: number) =>
              !Number.isInteger(waypointIndex) || waypointIndex < 0 || waypointIndex >= intermediateStops.length
            ) ||
            new Set(optimizedIndexes).size !== intermediateStops.length
          ) {
            return new Response(
              JSON.stringify({ error: "Google Routes did not return a valid optimized waypoint order." }),
              { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          const orderedIntermediates = optimizedIndexes.map((waypointIndex: number) =>
            intermediateStops[waypointIndex]
          );
          routedStops = startLocation
            ? [...orderedIntermediates, destination]
            : [stops[0], ...orderedIntermediates, destination];
        }

        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Manila",
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        });
        const dayKeys: Record<string, string> = {
          Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat",
        };
        let elapsedMinutes = 0;
        let totalEstimatedMinutes = 0;
        const legTimes = legs.map((leg: { distanceMeters: number; duration: string }) => {
          const distanceKm = leg.distanceMeters / 1000;
          const durationSeconds = googleDurationSeconds(leg.duration)!;
          const travelMinutes = mode === "jeepney"
            ? (distanceKm / TRANSPORT_SPEEDS.jeepney) * 60
            : durationSeconds / 60;
          const minutes = travelMinutes + TRANSFER_OVERHEAD[mode];
          totalEstimatedMinutes += minutes;
          return minutes;
        });
        const arrivals = routedStops.map((stop, index) => {
          if (index > 0 || startLocation) {
            elapsedMinutes += legTimes[startLocation ? index : index - 1];
          }
          const arrival = new Date(departure.getTime() + elapsedMinutes * 60_000);
          const parts: Record<string, string> = Object.fromEntries(
            formatter.formatToParts(arrival).map((part) => [part.type, part.value]),
          );
          const day = dayKeys[parts.weekday];
          const hours = stop.operating_hours?.[day];
          const arrivalMinutes = Number(parts.hour) * 60 + Number(parts.minute);
          let closingAlert: string | null = null;
          let hoursLabel = hours || "Hours not provided";
          const hoursMatch = hours?.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
          if (hours?.toLowerCase() === "closed") {
            hoursLabel = "Closed that day";
            closingAlert = "This boutique is closed when you arrive.";
          } else if (hoursMatch) {
            const openMinutes = Number(hoursMatch[1]) * 60 + Number(hoursMatch[2]);
            const closeMinutes = Number(hoursMatch[3]) * 60 + Number(hoursMatch[4]);
            if (arrivalMinutes < openMinutes) closingAlert = `Opens at ${hoursMatch[1]}:${hoursMatch[2]}; you arrive before opening.`;
            else if (arrivalMinutes >= closeMinutes) closingAlert = `Closes at ${hoursMatch[3]}:${hoursMatch[4]}; you arrive after closing.`;
            else if (closeMinutes - arrivalMinutes <= 30) closingAlert = "Arriving shortly before closing.";
            hoursLabel = hours;
          }
          return {
            boutique_id: stop.boutique_id,
            boutique_name: stop.boutique_name,
            arrival_at: arrival.toISOString(),
            local_arrival: formatter.format(arrival),
            hours_label: hoursLabel,
            closing_alert: closingAlert,
          };
        });

        return new Response(
          JSON.stringify({
            arrivals,
            ordered_stops: routedStops,
            estimated_total_time_minutes: Math.round(totalEstimatedMinutes),
            total_route_distance_km: route.distanceMeters / 1000,
            route_coordinates: routeCoordinates.map(([lat, lng]) => [lng, lat]),
            route_provider: "Google Maps Routes API",
            waypoint_optimization: intermediateStops.length > 1,
            traffic_included: false,
            timezone: "Asia/Manila",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const costing = mode === "walking"
        ? "pedestrian"
        : mode === "motorbike"
          ? "motorcycle"
          : "auto";
      const valhallaUrl = Deno.env.get("VALHALLA_API_URL")
        || "https://valhalla1.openstreetmap.de/route";
      let valhallaResponse: Response;
      try {
        valhallaResponse = await fetch(valhallaUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            locations: points.map((point) => ({
              lat: point.lat,
              lon: point.lng,
              type: "break",
            })),
            costing,
            costing_options: {
              auto: { use_highways: 0.5, use_tolls: 0.0 },
              motorcycle: { use_highways: 0.5, use_tolls: 0.0 },
            },
            units: "km",
            language: "en-US",
            shape_format: "polyline6",
          }),
          signal: AbortSignal.timeout(15000),
        });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: `Valhalla routing request failed: ${error instanceof Error ? error.message : "network error"}`,
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      let valhallaResult: ValhallaResponse;
      try {
        valhallaResult = await valhallaResponse.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Valhalla returned an invalid response." }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const valhallaRoute = valhallaResult.trip;
      const valhallaLegs = valhallaRoute?.legs;
      if (!valhallaResponse.ok) {
        return new Response(
          JSON.stringify({
            error: valhallaRoute?.status_message
              || `Valhalla routing service returned ${valhallaResponse.status}.`,
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (
        valhallaRoute?.status !== 0
        || !Array.isArray(valhallaLegs)
        || valhallaLegs.length !== points.length - 1
        || !valhallaLegs.every((leg: ValhallaLeg) =>
          Number.isFinite(leg.summary?.length)
          && Number.isFinite(leg.summary?.time)
          && typeof leg.shape === "string"
        )
      ) {
        return new Response(
          JSON.stringify({
            error: valhallaRoute?.status_message
              || "Valhalla could not find a route between the selected locations.",
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      let routeCoordinates: [number, number][];
      try {
        routeCoordinates = valhallaLegs.flatMap(
          (leg: ValhallaLeg, index: number) => {
            const legCoordinates = decodePolyline(leg.shape, 6);
            return index === 0 ? legCoordinates : legCoordinates.slice(1);
          },
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Valhalla returned an invalid route shape.",
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (routeCoordinates.length < 2) {
        return new Response(
          JSON.stringify({ error: "Valhalla returned an incomplete route geometry." }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const route = {
        distance: valhallaLegs.reduce(
          (total: number, leg: ValhallaLeg) => total + leg.summary.length,
          0,
        ) * 1000,
        legs: valhallaLegs.map((leg: ValhallaLeg) => ({
          distance: leg.summary.length * 1000,
          duration: leg.summary.time,
        })),
        geometry: { coordinates: routeCoordinates.map(([lat, lng]) => [lng, lat]) },
      };

      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
      const dayKeys: Record<string, string> = {
        Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat",
      };
      let elapsedMinutes = 0;
      let totalEstimatedMinutes = 0;
      const legTimes = route.legs.map((leg: { distance: number; duration: number }) => {
        const distanceKm = leg.distance / 1000;
        const travelMinutes = mode === "jeepney"
          ? (distanceKm / TRANSPORT_SPEEDS[mode]) * 60
          : leg.duration / 60;
        const minutes = travelMinutes + TRANSFER_OVERHEAD[mode];
        totalEstimatedMinutes += minutes;
        return minutes;
      });
      const arrivals = stops.map((stop, index) => {
        if (index > 0 || startLocation) {
          elapsedMinutes += legTimes[startLocation ? index : index - 1];
        }
        const arrival = new Date(departure.getTime() + elapsedMinutes * 60_000);
        const parts: Record<string, string> = Object.fromEntries(formatter.formatToParts(arrival).map((part) => [part.type, part.value]));
        const day = dayKeys[parts.weekday];
        const hours = stop.operating_hours?.[day];
        const arrivalMinutes = Number(parts.hour) * 60 + Number(parts.minute);
        let closingAlert: string | null = null;
        let hoursLabel = hours || "Hours not provided";
        const hoursMatch = hours?.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
        if (hours?.toLowerCase() === "closed") {
          hoursLabel = "Closed that day";
          closingAlert = "This boutique is closed when you arrive.";
        } else if (hoursMatch) {
          const openMinutes = Number(hoursMatch[1]) * 60 + Number(hoursMatch[2]);
          const closeMinutes = Number(hoursMatch[3]) * 60 + Number(hoursMatch[4]);
          if (arrivalMinutes < openMinutes) closingAlert = `Opens at ${hoursMatch[1]}:${hoursMatch[2]}; you arrive before opening.`;
          else if (arrivalMinutes >= closeMinutes) closingAlert = `Closes at ${hoursMatch[3]}:${hoursMatch[4]}; you arrive after closing.`;
          else if (closeMinutes - arrivalMinutes <= 30) closingAlert = "Arriving shortly before closing.";
          hoursLabel = hours;
        }
        return {
          boutique_id: stop.boutique_id,
          boutique_name: stop.boutique_name,
          arrival_at: arrival.toISOString(),
          local_arrival: formatter.format(arrival),
          hours_label: hoursLabel,
          closing_alert: closingAlert,
        };
      });

      return new Response(
        JSON.stringify({
          arrivals,
          ordered_stops: stops,
          estimated_total_time_minutes: Math.round(totalEstimatedMinutes),
          total_route_distance_km: route.distance / 1000,
          route_coordinates: route.geometry.coordinates,
          route_provider: "Valhalla (OpenStreetMap)",
          waypoint_optimization: false,
          traffic_included: false,
          timezone: "Asia/Manila",
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
