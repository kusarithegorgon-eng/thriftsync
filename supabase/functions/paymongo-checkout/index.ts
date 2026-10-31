import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PAYMONGO_CREATE_URL = "https://api.paymongo.com/v2/checkout_sessions";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function paymongoAuthHeader(secretKey: string) {
  return `Basic ${btoa(`${secretKey}:`)}`;
}

function paymongoErrorMessage(payload: unknown, fallback: string) {
  const errors = (payload as { errors?: { detail?: string; code?: string }[] })?.errors;
  const first = errors?.[0];
  return first?.detail || first?.code || fallback;
}

function toCentavos(pesos: number) {
  return Math.round(Number(pesos) * 100);
}

function isPaidSession(session: Record<string, unknown>) {
  const attributes = (session.attributes || session) as Record<string, unknown>;
  const paymentIntent = attributes.payment_intent as { status?: string } | undefined;
  if (attributes.status === "paid" || paymentIntent?.status === "succeeded") {
    return true;
  }
  const payments = (attributes.payments || []) as Record<string, unknown>[];
  return payments.some((payment) => {
    const nested = (payment.attributes || payment) as Record<string, unknown>;
    return nested.status === "paid";
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const secretKey = Deno.env.get("PAYMONGO_SECRET_KEY");
    if (!secretKey || secretKey.includes("your_secret_key")) {
      return jsonResponse(500, {
        error: "PAYMONGO_SECRET_KEY is not set on the server. Use supabase secrets set PAYMONGO_SECRET_KEY=...",
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Missing authorization header" });
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const action = body.action;

    if (action === "create") {
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length < 1 || items.length > 50) {
        return jsonResponse(400, { error: "The cart is empty or invalid." });
      }

      const listingIds = items.map((item: { listing_id: string }) => item.listing_id);
      const { data: listings, error: listingError } = await userClient
        .from("listings")
        .select("id, title, price, status, moderation_status, boutique_id, category, listing_type")
        .in("id", listingIds);

      if (listingError) {
        return jsonResponse(400, { error: listingError.message });
      }
      if (!listings || listings.length !== listingIds.length) {
        return jsonResponse(409, { error: "One or more cart items are no longer available." });
      }

      let subtotalPesos = 0;
      for (const listing of listings) {
        const requested = items.find((item: { listing_id: string }) => item.listing_id === listing.id);
        if (listing.status !== "active" || listing.moderation_status !== "approved") {
          return jsonResponse(409, { error: "One or more cart items are no longer available." });
        }
        if (requested && Number(requested.amount) !== Number(listing.price)) {
          return jsonResponse(409, { error: "An item price changed. Refresh your cart." });
        }
        subtotalPesos += Number(listing.price);
      }

      let discountPesos = 0;
      const voucherCode = body.voucher_code || null;
      if (voucherCode) {
        const { data: voucherResult, error: voucherError } = await userClient.rpc("validate_voucher", {
          p_code: voucherCode,
          p_cart_total: subtotalPesos,
          p_has_auction_items: listings.some((listing: { listing_type?: string }) => listing.listing_type === "auction"),
          p_boutique_ids: listings.map((listing: { boutique_id?: string }) => listing.boutique_id).filter(Boolean),
          p_categories: listings.map((listing: { category?: string }) => listing.category).filter(Boolean),
        });
        if (voucherError) return jsonResponse(400, { error: voucherError.message });
        const result = Array.isArray(voucherResult) ? voucherResult[0] : voucherResult;
        if (!result?.valid) {
          return jsonResponse(400, { error: result?.message || "The voucher is invalid." });
        }
        discountPesos = Number(result.discount_amount || 0);
      }

      const payablePesos = Math.max(0, subtotalPesos - discountPesos);
      const amountCentavos = toCentavos(payablePesos);
      if (amountCentavos < 100) {
        return jsonResponse(400, { error: "PayMongo requires a payable total of at least ₱1." });
      }

      const lineItems = [{
        name: "ThriftSync order",
        amount: amountCentavos,
        currency: "PHP",
        quantity: 1,
      }];

      const deliveryMethod = body.delivery_method || "courier";
      const lockerLocationId = body.locker_location_id || null;
      const shippingAddress = String(body.shipping_address || "").slice(0, 2000);
      const successUrl = String(body.success_url || "");
      const cancelUrl = String(body.cancel_url || "");
      if (!successUrl || !cancelUrl) {
        return jsonResponse(400, { error: "Missing PayMongo return URLs." });
      }

      const payload = {
        items: listings.map((listing) => ({ listing_id: listing.id, amount: Number(listing.price) })),
        shipping_address: shippingAddress,
        voucher_code: voucherCode,
        delivery_method: deliveryMethod,
        locker_location_id: lockerLocationId,
      };

      const createSession = async (paymentMethodTypes: string[]) => {
        const response = await fetch(PAYMONGO_CREATE_URL, {
          method: "POST",
          headers: {
            Authorization: paymongoAuthHeader(secretKey),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            data: {
              attributes: {
                send_email_receipt: true,
                show_description: true,
                show_line_items: true,
                description: "ThriftSync Cebu order",
                line_items: lineItems,
                payment_method_types: paymentMethodTypes,
                success_url: successUrl,
                cancel_url: cancelUrl,
                metadata: {
                  buyer_id: userData.user.id,
                },
              },
            },
          }),
        });
        const json = await response.json();
        return { response, json };
      };

      let { response, json } = await createSession(["card", "gcash", "paymaya", "grab_pay"]);
      if (!response.ok) {
        const retry = await createSession(["card"]);
        response = retry.response;
        json = retry.json;
      }
      if (!response.ok) {
        return jsonResponse(response.status, {
          error: paymongoErrorMessage(json, "PayMongo could not create a checkout session."),
        });
      }

      const session = json.data;
      const checkoutSessionId = session.id;
      const checkoutUrl = session.attributes?.checkout_url;
      if (!checkoutSessionId || !checkoutUrl) {
        return jsonResponse(502, { error: "PayMongo returned an incomplete checkout session." });
      }

      const { error: insertError } = await adminClient.from("paymongo_checkouts").insert({
        buyer_id: userData.user.id,
        checkout_session_id: checkoutSessionId,
        status: "pending",
        payload,
        amount_centavos: amountCentavos,
      });
      if (insertError) {
        return jsonResponse(500, { error: insertError.message });
      }

      return jsonResponse(200, {
        checkout_session_id: checkoutSessionId,
        checkout_url: checkoutUrl,
      });
    }

    if (action === "confirm") {
      const checkoutSessionId = String(body.checkout_session_id || "");
      if (!checkoutSessionId) {
        return jsonResponse(400, { error: "Missing checkout session id." });
      }

      const { data: localRow, error: localError } = await adminClient
        .from("paymongo_checkouts")
        .select("*")
        .eq("checkout_session_id", checkoutSessionId)
        .eq("buyer_id", userData.user.id)
        .maybeSingle();
      if (localError) return jsonResponse(500, { error: localError.message });
      if (!localRow) return jsonResponse(404, { error: "Checkout session not found." });
      if (localRow.status === "fulfilled" && localRow.order_ids?.length) {
        return jsonResponse(200, {
          success: true,
          already_fulfilled: true,
          order_ids: localRow.order_ids,
        });
      }

      let retrieve = await fetch(`https://api.paymongo.com/v2/checkout_sessions/${checkoutSessionId}`, {
        headers: {
          Authorization: paymongoAuthHeader(secretKey),
          Accept: "application/json",
        },
      });
      let sessionJson = await retrieve.json();
      if (retrieve.status === 404) {
        retrieve = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${checkoutSessionId}`, {
          headers: {
            Authorization: paymongoAuthHeader(secretKey),
            Accept: "application/json",
          },
        });
        sessionJson = await retrieve.json();
      }
      if (!retrieve.ok) {
        return jsonResponse(retrieve.status, {
          error: paymongoErrorMessage(sessionJson, "Could not retrieve the PayMongo session."),
        });
      }

      const session = sessionJson.data;
      if (!isPaidSession(session)) {
        await adminClient
          .from("paymongo_checkouts")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", localRow.id);
        return jsonResponse(402, { error: "Payment is not complete yet. Finish checkout on PayMongo and return here." });
      }

      await adminClient
        .from("paymongo_checkouts")
        .update({ status: "paid", updated_at: new Date().toISOString() })
        .eq("id", localRow.id);

      const payload = localRow.payload as {
        items: { listing_id: string; amount: number }[];
        shipping_address: string;
        voucher_code: string | null;
        delivery_method: string;
        locker_location_id: string | null;
      };

      const { data: checkoutResult, error: checkoutError } = await userClient.rpc(
        "checkout_fixed_items_with_fulfillment",
        {
          p_shipping_address: payload.shipping_address,
          p_items: payload.items,
          p_voucher_code: payload.voucher_code,
          p_delivery_method: payload.delivery_method,
          p_locker_location_id: payload.locker_location_id,
        },
      );
      if (checkoutError) {
        return jsonResponse(400, {
          error: `Payment succeeded, but the order could not be created: ${checkoutError.message}`,
        });
      }

      const result = Array.isArray(checkoutResult) ? checkoutResult[0] : checkoutResult;
      const orderIds = result?.order_ids || [];
      await adminClient
        .from("paymongo_checkouts")
        .update({
          status: "fulfilled",
          order_ids: orderIds,
          updated_at: new Date().toISOString(),
        })
        .eq("id", localRow.id);

      return jsonResponse(200, {
        success: true,
        order_ids: orderIds,
        discount_amount: result?.discount_amount || 0,
      });
    }

    return jsonResponse(400, { error: "Unknown PayMongo action." });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    return jsonResponse(status, {
      error: err instanceof Error ? err.message : "PayMongo checkout failed.",
    });
  }
});
