import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { corsHeaders as supabaseCorsHeaders } from "npm:@supabase/supabase-js@2.117.3/cors";

const corsHeaders = {
  ...supabaseCorsHeaders,
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
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
  if (!session || typeof session !== "object") return false;
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

async function retrievePaymongoSession(secretKey: string, checkoutSessionId: string) {
  let response = await fetch(`https://api.paymongo.com/v2/checkout_sessions/${checkoutSessionId}`, {
    headers: {
      Authorization: paymongoAuthHeader(secretKey),
      Accept: "application/json",
    },
  });
  let payload = await response.json();
  if (response.status === 404) {
    response = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${checkoutSessionId}`, {
      headers: {
        Authorization: paymongoAuthHeader(secretKey),
        Accept: "application/json",
      },
    });
    payload = await response.json();
  }
  return { response, payload };
}

async function expirePaymongoSession(secretKey: string, checkoutSessionId: string) {
  const response = await fetch(
    `https://api.paymongo.com/v1/checkout_sessions/${checkoutSessionId}/expire`,
    {
      method: "POST",
      headers: {
        Authorization: paymongoAuthHeader(secretKey),
        Accept: "application/json",
      },
    },
  );
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function fulfillPaidCheckout(
  adminClient: ReturnType<typeof createClient>,
  checkoutId: string,
) {
  const { data: checkout, error: checkoutError } = await adminClient
    .from("paymongo_checkouts")
    .select("payload")
    .eq("id", checkoutId)
    .maybeSingle();
  if (checkoutError) throw new Error(`Could not read the checkout record: ${checkoutError.message}`);
  if (!checkout) throw new Error("Checkout record not found.");

  const { error: statusError } = await adminClient
    .from("paymongo_checkouts")
    .update({ status: "paid", updated_at: new Date().toISOString() })
    .eq("id", checkoutId)
    .in("status", ["pending", "paid"]);
  if (statusError) throw new Error(`Could not record PayMongo payment: ${statusError.message}`);

  const rpcName = checkout.payload?.kind === "auction_payment"
    ? "fulfill_paymongo_auction_order"
    : "fulfill_paymongo_checkout";
  const { data, error } = await adminClient.rpc(rpcName, {
    p_checkout_id: checkoutId,
  });
  if (error) throw new Error(`Payment succeeded, but order fulfillment failed: ${error.message}`);
  const result = Array.isArray(data) ? data[0] : data;
  if (!Array.isArray(result?.order_ids) || result.order_ids.length === 0) {
    throw new Error("Payment succeeded, but no orders were returned for fulfillment.");
  }
  return result as { order_ids: string[]; discount_amount: number };
}

async function deferCheckoutReservation(
  adminClient: ReturnType<typeof createClient>,
  checkoutId: string,
) {
  const { error } = await adminClient.rpc("extend_paymongo_checkout_reservation", {
    p_checkout_id: checkoutId,
  });
  if (error) throw new Error(`Could not extend the inventory reservation: ${error.message}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return Response.json({ ok: true }, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = await req.json();
    const action = body.action;
    const secretKey = Deno.env.get("PAYMONGO_SECRET_KEY") || "";
    const authHeader = req.headers.get("Authorization");
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (action === "cleanup_expired") {
      if (authHeader !== `Bearer ${serviceRoleKey}`) {
        return jsonResponse(401, { error: "Unauthorized cleanup request." });
      }
      if (!secretKey || !secretKey.startsWith("sk_")) {
        return jsonResponse(500, { error: "PAYMONGO_SECRET_KEY is not configured on the server." });
      }

      const { data: expiredCheckouts, error: expiredError } = await adminClient
        .from("paymongo_checkouts")
        .select("id, checkout_session_id, status")
        .or(`status.eq.paid,and(status.eq.pending,expires_at.lte.${new Date().toISOString()})`)
        .order("expires_at", { ascending: true })
        .limit(100);
      if (expiredError) return jsonResponse(500, { error: expiredError.message });

      let released = 0;
      let fulfilled = 0;
      let deferred = 0;
      const failures: string[] = [];

      for (const checkout of expiredCheckouts || []) {
        if (checkout.status === "paid") {
          try {
            await fulfillPaidCheckout(adminClient, checkout.id);
            fulfilled += 1;
          } catch (error) {
            deferred += 1;
            failures.push(
              `${checkout.id}: ${error instanceof Error ? error.message : "Paid checkout fulfillment failed."}`,
            );
          }
          continue;
        }

        if (!checkout.checkout_session_id) {
          try {
            const { count, error: reservationError } = await adminClient
              .from("listings")
              .select("id", { count: "exact", head: true })
              .eq("reserved_by_checkout_id", checkout.id)
              .eq("status", "reserved");
            if (reservationError) throw new Error(reservationError.message);
            if (count === 0) {
              const { error: releaseError } = await adminClient.rpc(
                "release_paymongo_checkout_reservation",
                { p_checkout_id: checkout.id, p_status: "failed" },
              );
              if (releaseError) throw new Error(releaseError.message);
              released += 1;
              continue;
            }

            await deferCheckoutReservation(adminClient, checkout.id);
            deferred += 1;
            failures.push(`${checkout.id}: checkout session ID is missing; reservation was retained.`);
          } catch (error) {
            deferred += 1;
            failures.push(
              `${checkout.id}: ${error instanceof Error ? error.message : "Could not defer reservation."}`,
            );
          }
          continue;
        }

        try {
          let { response: retrieve, payload: sessionJson } = await retrievePaymongoSession(
            secretKey,
            checkout.checkout_session_id,
          );
          if (!retrieve.ok) {
            throw new Error(paymongoErrorMessage(sessionJson, "Could not retrieve the checkout session."));
          }

          if (isPaidSession(sessionJson.data)) {
            await fulfillPaidCheckout(adminClient, checkout.id);
            fulfilled += 1;
            continue;
          }

          const sessionStatus = (sessionJson.data?.attributes || sessionJson.data)?.status;
          if (sessionStatus !== "expired") {
            const { response: expireResponse } = await expirePaymongoSession(
              secretKey,
              checkout.checkout_session_id,
            );
            if (expireResponse.ok) {
              const { error: releaseError } = await adminClient.rpc(
                "release_paymongo_checkout_reservation",
                { p_checkout_id: checkout.id, p_status: "expired" },
              );
              if (releaseError) throw new Error(releaseError.message);
              released += 1;
              continue;
            }

            const refreshed = await retrievePaymongoSession(secretKey, checkout.checkout_session_id);
            retrieve = refreshed.response;
            sessionJson = refreshed.payload;
            if (!retrieve.ok) {
              throw new Error(paymongoErrorMessage(sessionJson, "Could not recheck the checkout session."));
            }
            if (isPaidSession(sessionJson.data)) {
              await fulfillPaidCheckout(adminClient, checkout.id);
              fulfilled += 1;
              continue;
            }
            const refreshedStatus = (sessionJson.data?.attributes || sessionJson.data)?.status;
            if (refreshedStatus !== "expired") {
              deferred += 1;
              await deferCheckoutReservation(adminClient, checkout.id);
              continue;
            }
          }

          const { error: releaseError } = await adminClient.rpc(
            "release_paymongo_checkout_reservation",
            { p_checkout_id: checkout.id, p_status: "expired" },
          );
          if (releaseError) throw new Error(releaseError.message);
          released += 1;
        } catch (error) {
          deferred += 1;
          failures.push(
            `${checkout.id}: ${error instanceof Error ? error.message : "Checkout cleanup failed."}`,
          );
          try {
            await deferCheckoutReservation(adminClient, checkout.id);
          } catch (deferError) {
            failures.push(
              `${checkout.id}: ${deferError instanceof Error ? deferError.message : "Could not defer reservation."}`,
            );
          }
        }
      }

      return jsonResponse(failures.length > 0 ? 500 : 200, {
        released,
        fulfilled,
        deferred,
        failures,
      });
    }

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

    if (
      (action === "create" || action === "create_auction_payment" || action === "confirm" || action === "cancel") &&
      (!secretKey || secretKey.includes("your_secret_key"))
    ) {
      return jsonResponse(500, {
        error: "PAYMONGO_SECRET_KEY is not set on the server. Use supabase secrets set PAYMONGO_SECRET_KEY=...",
      });
    }

    if (action === "create_cash_on_delivery") {
      const items = Array.isArray(body.items) ? body.items : [];
      const deliveryMethod = body.delivery_method;
      if (items.length < 1 || items.length > 50) {
        return jsonResponse(400, { error: "The cart is empty or invalid." });
      }
      if (deliveryMethod !== "courier" && deliveryMethod !== "pickup") {
        return jsonResponse(400, { error: "Pay on receipt is available only for courier delivery or boutique pickup." });
      }

      const listingIds = items.map((item: { listing_id: string }) => item.listing_id);
      if (new Set(listingIds).size !== listingIds.length) {
        return jsonResponse(400, { error: "A listing appears more than once in the cart." });
      }
      const { data: listings, error: listingError } = await userClient
        .from("listings")
        .select("id, price, status, moderation_status, listing_type")
        .in("id", listingIds);
      if (listingError) return jsonResponse(400, { error: listingError.message });
      if (!listings || listings.length !== listingIds.length) {
        return jsonResponse(409, { error: "One or more cart items are no longer available." });
      }
      for (const listing of listings) {
        const requested = items.find((item: { listing_id: string }) => item.listing_id === listing.id);
        if (
          listing.status !== "active" ||
          listing.moderation_status !== "approved" ||
          listing.listing_type === "auction"
        ) {
          return jsonResponse(409, { error: "One or more cart items are not eligible for fixed-item checkout." });
        }
        if (!requested || Number(requested.amount) !== Number(listing.price)) {
          return jsonResponse(409, { error: "An item price changed. Refresh your cart." });
        }
      }

      const { data: checkoutResult, error: checkoutError } = await userClient.rpc(
        "checkout_fixed_items_with_fulfillment",
        {
          p_shipping_address: String(body.shipping_address || "").slice(0, 2000),
          p_items: items.map((item: { listing_id: string; amount: number }) => ({
            listing_id: item.listing_id,
            amount: item.amount,
          })),
          p_voucher_code: body.voucher_code || null,
          p_delivery_method: deliveryMethod,
          p_locker_location_id: null,
        },
      );
      if (checkoutError) return jsonResponse(400, { error: checkoutError.message });
      const result = Array.isArray(checkoutResult) ? checkoutResult[0] : checkoutResult;
      const orderIds = result?.order_ids || [];
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return jsonResponse(500, { error: "Cash-on-receipt checkout did not create any orders." });
      }

      const { error: paymentMetadataError } = await adminClient
        .from("orders")
        .update({ payment_method: "cash_on_delivery", payment_is_simulated: false })
        .in("id", orderIds)
        .eq("buyer_id", userData.user.id);
      if (paymentMetadataError) {
        return jsonResponse(500, {
          error: `Orders were created, but could not be marked for payment on receipt: ${paymentMetadataError.message}`,
          order_ids: orderIds,
        });
      }
      return jsonResponse(200, { success: true, order_ids: orderIds });
    }

    if (action === "simulate_gcash") {
      if (
        Deno.env.get("GCASH_SIMULATION_ENABLED") !== "true" ||
        !secretKey.startsWith("sk_test_")
      ) {
        return jsonResponse(403, {
          error: "GCash simulation requires GCASH_SIMULATION_ENABLED=true and a PayMongo test secret key on this Supabase project.",
        });
      }

      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length < 1 || items.length > 50) {
        return jsonResponse(400, { error: "The cart is empty or invalid." });
      }
      const listingIds = items.map((item: { listing_id: string }) => item.listing_id);
      const { data: listings, error: listingError } = await userClient
        .from("listings")
        .select("id, price, status, moderation_status, listing_type")
        .in("id", listingIds);
      if (listingError) return jsonResponse(400, { error: listingError.message });
      if (!listings || listings.length !== listingIds.length) {
        return jsonResponse(409, { error: "One or more cart items are no longer available." });
      }
      for (const listing of listings) {
        const requested = items.find((item: { listing_id: string }) => item.listing_id === listing.id);
        if (
          listing.status !== "active" ||
          listing.moderation_status !== "approved" ||
          listing.listing_type === "auction"
        ) {
          return jsonResponse(409, { error: "One or more cart items are not eligible for fixed-item checkout." });
        }
        if (requested && Number(requested.amount) !== Number(listing.price)) {
          return jsonResponse(409, { error: "An item price changed. Refresh your cart." });
        }
      }

      const { data: checkoutResult, error: checkoutError } = await userClient.rpc(
        "checkout_fixed_items_with_fulfillment",
        {
          p_shipping_address: String(body.shipping_address || "").slice(0, 2000),
          p_items: items.map((item: { listing_id: string; amount: number }) => ({
            listing_id: item.listing_id,
            amount: item.amount,
          })),
          p_voucher_code: body.voucher_code || null,
          p_delivery_method: body.delivery_method || "courier",
          p_locker_location_id: body.locker_location_id || null,
        },
      );
      if (checkoutError) return jsonResponse(400, { error: checkoutError.message });
      const result = Array.isArray(checkoutResult) ? checkoutResult[0] : checkoutResult;
      const orderIds = result?.order_ids || [];
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return jsonResponse(500, { error: "The GCash demo did not create any orders." });
      }

      const { error: paymentMetadataError } = await adminClient
        .from("orders")
        .update({ payment_method: "gcash_demo", payment_is_simulated: true })
        .in("id", orderIds)
        .eq("buyer_id", userData.user.id);
      if (paymentMetadataError) {
        return jsonResponse(500, {
          error: `Demo orders were created, but could not be marked as simulated: ${paymentMetadataError.message}`,
          order_ids: orderIds,
        });
      }
      return jsonResponse(200, { success: true, order_ids: orderIds });
    }

    if (action === "cancel") {
      const checkoutSessionId = String(body.checkout_session_id || "");
      if (!checkoutSessionId) {
        return jsonResponse(400, { error: "Missing checkout session id." });
      }

      const { data: checkout, error: checkoutError } = await adminClient
        .from("paymongo_checkouts")
        .select("id, status, order_ids")
        .eq("checkout_session_id", checkoutSessionId)
        .eq("buyer_id", userData.user.id)
        .maybeSingle();
      if (checkoutError) return jsonResponse(500, { error: checkoutError.message });
      if (!checkout) return jsonResponse(404, { error: "Checkout session not found." });
      if (checkout.status === "fulfilled") {
        return jsonResponse(200, {
          success: true,
          order_already_created: true,
          order_ids: checkout.order_ids || [],
        });
      }
      if (checkout.status === "expired" || checkout.status === "failed") {
        return jsonResponse(200, { success: true, already_cancelled: true });
      }

      const { response: retrieve, payload: sessionJson } = await retrievePaymongoSession(
        secretKey,
        checkoutSessionId,
      );
      if (!retrieve.ok) {
        return jsonResponse(retrieve.status, {
          error: paymongoErrorMessage(sessionJson, "Could not retrieve the checkout session."),
        });
      }
      if (isPaidSession(sessionJson.data)) {
        const result = await fulfillPaidCheckout(adminClient, checkout.id);
        return jsonResponse(200, {
          success: true,
          order_already_created: true,
          order_ids: result.order_ids,
        });
      }

      const sessionStatus = (sessionJson.data?.attributes || sessionJson.data)?.status;
      if (sessionStatus !== "expired") {
        const { response: expireResponse } = await expirePaymongoSession(
          secretKey,
          checkoutSessionId,
        );
        if (!expireResponse.ok) {
          const refreshed = await retrievePaymongoSession(secretKey, checkoutSessionId);
          if (!refreshed.response.ok) {
            return jsonResponse(refreshed.response.status, {
              error: paymongoErrorMessage(refreshed.payload, "Could not recheck the checkout session."),
            });
          }
          if (isPaidSession(refreshed.payload.data)) {
            const result = await fulfillPaidCheckout(adminClient, checkout.id);
            return jsonResponse(200, {
              success: true,
              order_already_created: true,
              order_ids: result.order_ids,
            });
          }
          const refreshedStatus = (refreshed.payload.data?.attributes || refreshed.payload.data)?.status;
          if (refreshedStatus !== "expired") {
            return jsonResponse(409, {
              error: "Payment is still processing. The item remains reserved until PayMongo confirms the outcome.",
            });
          }
        }
      }

      const { error: releaseError } = await adminClient.rpc(
        "release_paymongo_checkout_reservation",
        { p_checkout_id: checkout.id, p_status: "expired" },
      );
      if (releaseError) return jsonResponse(500, { error: releaseError.message });
      return jsonResponse(200, { success: true, cancelled: true });
    }

    if (action === "notify_sellers") {
      const orderIds = Array.isArray(body.order_ids)
        ? [...new Set(body.order_ids.filter((id: unknown): id is string => typeof id === "string"))]
        : [];
      if (orderIds.length < 1 || orderIds.length > 50) {
        return jsonResponse(400, { error: "Order ids are missing or invalid." });
      }

      const { data: orders, error: ordersError } = await userClient
        .from("orders")
        .select("id, amount, delivery_method, payment_method, payment_is_simulated, listings(title), boutiques(name, seller_id)")
        .in("id", orderIds)
        .eq("buyer_id", userData.user.id);
      if (ordersError) return jsonResponse(400, { error: ordersError.message });
      if (!orders || orders.length !== orderIds.length) {
        return jsonResponse(404, { error: "One or more orders were not found for this buyer." });
      }

      const serviceId = Deno.env.get("EMAILJS_SERVICE_ID");
      const templateId = Deno.env.get("EMAILJS_ORDER_TEMPLATE_ID");
      const publicKey = Deno.env.get("EMAILJS_PUBLIC_KEY");
      if (!serviceId || !templateId || !publicKey) {
        return jsonResponse(200, {
          status: "not_configured",
          sent_count: 0,
          message: "Seller email is not configured. The new order is visible in the seller dashboard.",
        });
      }

      const { data: buyerProfile, error: buyerProfileError } = await adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", userData.user.id)
        .maybeSingle();
      if (buyerProfileError) return jsonResponse(500, { error: buyerProfileError.message });

      type NotificationOrder = {
        id: string;
        amount: number;
        delivery_method: string;
        payment_method: string;
        payment_is_simulated: boolean;
        listings: { title: string } | null;
        boutiques: { name: string; seller_id: string } | null;
      };
      const sellerOrders = new Map<string, NotificationOrder[]>();
      const failures: string[] = [];
      for (const order of orders as NotificationOrder[]) {
        const sellerId = order.boutiques?.seller_id;
        if (!sellerId) {
          failures.push("Could not resolve a seller for an order.");
          continue;
        }
        sellerOrders.set(sellerId, [...(sellerOrders.get(sellerId) || []), order]);
      }

      let sentCount = 0;
      for (const [sellerId, sellerOrderList] of sellerOrders) {
        const { data: sellerResult, error: sellerError } = await adminClient.auth.admin.getUserById(sellerId);
        const sellerEmail = sellerResult?.user?.email;
        if (sellerError || !sellerEmail) {
          failures.push("Could not resolve a seller email address.");
          continue;
        }
        const total = sellerOrderList.reduce((sum, order) => sum + Number(order.amount), 0);
        const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_id: serviceId,
            template_id: templateId,
            user_id: publicKey,
            template_params: {
              to_email: sellerEmail,
              buyer_name: buyerProfile?.display_name || userData.user.email || "ThriftSync buyer",
              buyer_email: userData.user.email || "",
              boutique_name: sellerOrderList[0].boutiques?.name || "Your boutique",
              order_items: sellerOrderList.map((order) => order.listings?.title || "Item").join(", "),
              order_ids: sellerOrderList.map((order) => order.id).join(", "),
              order_total: `PHP ${total.toFixed(2)}`,
              delivery_methods: [...new Set(sellerOrderList.map((order) => order.delivery_method))].join(", "),
              payment_notice: sellerOrderList.some((order) => order.payment_is_simulated)
                ? "GCash demo only — no payment collected."
                : sellerOrderList.some((order) => order.payment_method === "cash_on_delivery")
                  ? "Cash on receipt — collect payment directly from the buyer at handoff."
                : sellerOrderList.every((order) => order.payment_method === "paymongo")
                  ? "PayMongo payment confirmed."
                  : "Review the payment method shown in your ThriftSync dashboard.",
            },
          }),
        });
        if (!response.ok) {
          failures.push(`EmailJS rejected a seller notification (${response.status}).`);
          continue;
        }
        sentCount += 1;
      }

      return jsonResponse(200, {
        status: failures.length > 0 ? "failed" : "sent",
        sent_count: sentCount,
        message: failures.length > 0
          ? `${sentCount} seller email(s) sent; ${failures.join(" ")}`
          : `${sentCount} seller email notification(s) sent.`,
      });
    }

    if (action === "create_auction_payment") {
      const orderId = String(body.order_id || "");
      const successUrl = String(body.success_url || "");
      const cancelUrl = String(body.cancel_url || "");
      if (!orderId || !successUrl || !cancelUrl) {
        return jsonResponse(400, { error: "Missing auction order or PayMongo return URLs." });
      }

      const { data: checkoutRows, error: checkoutError } = await userClient.rpc(
        "create_auction_paymongo_checkout",
        { p_order_id: orderId },
      );
      if (checkoutError) return jsonResponse(409, { error: checkoutError.message });
      const checkout = Array.isArray(checkoutRows) ? checkoutRows[0] : checkoutRows;
      if (!checkout?.checkout_id || !checkout?.amount_centavos) {
        return jsonResponse(500, { error: "Could not prepare the auction payment." });
      }

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
                description: "ThriftSync winning auction payment",
                line_items: [{
                  name: `Auction payment: ${String(checkout.listing_title || "ThriftSync item").slice(0, 180)}`,
                  amount: Number(checkout.amount_centavos),
                  currency: "PHP",
                  quantity: 1,
                }],
                payment_method_types: paymentMethodTypes,
                success_url: successUrl,
                cancel_url: cancelUrl,
                reference_number: checkout.checkout_id,
                metadata: {
                  buyer_id: userData.user.id,
                  checkout_id: checkout.checkout_id,
                  order_id: orderId,
                },
              },
            },
          }),
        });
        const json = await response.json();
        return { response, json };
      };

      let response: Response;
      let json: { data?: { id?: string; attributes?: { checkout_url?: string } }; errors?: { detail?: string; code?: string }[] };
      try {
        ({ response, json } = await createSession(["card", "gcash", "paymaya", "grab_pay"]));
        if (!response.ok) {
          const retry = await createSession(["card"]);
          response = retry.response;
          json = retry.json;
        }
      } catch (error) {
        await adminClient.rpc("release_paymongo_checkout_reservation", {
          p_checkout_id: checkout.checkout_id,
          p_status: "failed",
        });
        return jsonResponse(502, {
          error: error instanceof Error ? error.message : "Could not connect to PayMongo.",
        });
      }
      if (!response.ok) {
        const { error: releaseError } = await adminClient.rpc("release_paymongo_checkout_reservation", {
          p_checkout_id: checkout.checkout_id,
          p_status: "failed",
        });
        return jsonResponse(response.status, {
          error: releaseError
            ? `${paymongoErrorMessage(json, "PayMongo could not create an auction payment session.")} Checkout cleanup failed: ${releaseError.message}`
            : paymongoErrorMessage(json, "PayMongo could not create an auction payment session."),
        });
      }

      const checkoutSessionId = json.data?.id;
      const checkoutUrl = json.data?.attributes?.checkout_url;
      if (!checkoutSessionId || !checkoutUrl) {
        await adminClient.rpc("release_paymongo_checkout_reservation", {
          p_checkout_id: checkout.checkout_id,
          p_status: "failed",
        });
        return jsonResponse(502, { error: "PayMongo returned an incomplete auction payment session." });
      }

      const { error: updateError } = await adminClient
        .from("paymongo_checkouts")
        .update({ checkout_session_id: checkoutSessionId, updated_at: new Date().toISOString() })
        .eq("id", checkout.checkout_id)
        .eq("status", "pending");
      if (updateError) {
        const { response: expireResponse } = await expirePaymongoSession(secretKey, checkoutSessionId);
        const { error: releaseError } = await adminClient.rpc("release_paymongo_checkout_reservation", {
          p_checkout_id: checkout.checkout_id,
          p_status: "failed",
        });
        return jsonResponse(500, {
          error: `Could not save the auction payment session: ${updateError.message}${
            !expireResponse.ok ? " PayMongo session could not be expired." : ""
          }${releaseError ? ` Checkout cleanup failed: ${releaseError.message}` : ""}`,
        });
      }

      return jsonResponse(200, {
        checkout_session_id: checkoutSessionId,
        checkout_url: checkoutUrl,
      });
    }

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

      const { data: localCheckout, error: localCheckoutError } = await adminClient
        .from("paymongo_checkouts")
        .insert({
          buyer_id: userData.user.id,
          checkout_session_id: null,
          status: "pending",
          payload,
          amount_centavos: amountCentavos,
        })
        .select("id, expires_at")
        .single();
      if (localCheckoutError || !localCheckout) {
        return jsonResponse(500, {
          error: localCheckoutError?.message || "Could not create the local checkout record.",
        });
      }

      const { error: reservationError } = await userClient.rpc("reserve_paymongo_checkout", {
        p_checkout_id: localCheckout.id,
      });
      if (reservationError) {
        await adminClient
          .from("paymongo_checkouts")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", localCheckout.id)
          .eq("status", "pending");
        return jsonResponse(409, { error: reservationError.message });
      }

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
                reference_number: localCheckout.id,
                metadata: {
                  buyer_id: userData.user.id,
                  checkout_id: localCheckout.id,
                },
              },
            },
          }),
        });
        const json = await response.json();
        return { response, json };
      };

      const paymentMethodTypes = body.payment_method === "gcash"
        ? ["gcash"]
        : ["card", "gcash", "paymaya", "grab_pay"];
      let response: Response;
      let json: { data?: { id?: string; attributes?: { checkout_url?: string } }; errors?: { detail?: string; code?: string }[] };
      try {
        ({ response, json } = await createSession(paymentMethodTypes));
        if (!response.ok && paymentMethodTypes.length > 1) {
          const retry = await createSession(["card"]);
          response = retry.response;
          json = retry.json;
        }
      } catch (error) {
        const { error: releaseError } = await adminClient.rpc(
          "release_paymongo_checkout_reservation",
          { p_checkout_id: localCheckout.id, p_status: "failed" },
        );
        return jsonResponse(502, {
          error: releaseError
            ? `Could not connect to PayMongo. Inventory cleanup failed: ${releaseError.message}`
            : error instanceof Error ? error.message : "Could not connect to PayMongo.",
        });
      }
      if (!response.ok) {
        const { error: releaseError } = await adminClient.rpc(
          "release_paymongo_checkout_reservation",
          { p_checkout_id: localCheckout.id, p_status: "failed" },
        );
        return jsonResponse(response.status, {
          error: releaseError
            ? `${paymongoErrorMessage(json, "PayMongo could not create a checkout session.")} Inventory cleanup failed: ${releaseError.message}`
            : paymongoErrorMessage(json, "PayMongo could not create a checkout session."),
        });
      }

      const session = json.data;
      const checkoutSessionId = session.id;
      const checkoutUrl = session.attributes?.checkout_url;
      if (!checkoutSessionId || !checkoutUrl) {
        const { error: releaseError } = await adminClient.rpc(
          "release_paymongo_checkout_reservation",
          { p_checkout_id: localCheckout.id, p_status: "failed" },
        );
        if (releaseError) {
          return jsonResponse(500, {
            error: `PayMongo returned an incomplete checkout session. Inventory cleanup failed: ${releaseError.message}`,
          });
        }
        return jsonResponse(502, { error: "PayMongo returned an incomplete checkout session." });
      }

      const { error: updateError } = await adminClient
        .from("paymongo_checkouts")
        .update({ checkout_session_id: checkoutSessionId, updated_at: new Date().toISOString() })
        .eq("id", localCheckout.id)
        .eq("status", "pending");
      if (updateError) {
        const { response: expireResponse } = await expirePaymongoSession(secretKey, checkoutSessionId);
        if (expireResponse.ok) {
          const { error: releaseError } = await adminClient.rpc("release_paymongo_checkout_reservation", {
            p_checkout_id: localCheckout.id,
            p_status: "failed",
          });
          if (releaseError) {
            return jsonResponse(500, {
              error: `Could not save the PayMongo session or release inventory: ${updateError.message}; ${releaseError.message}`,
            });
          }
        }
        return jsonResponse(500, {
          error: expireResponse.ok
            ? `Could not save the PayMongo session: ${updateError.message}`
            : `Could not save the PayMongo session or safely expire it. The item remains reserved for safety. ${updateError.message}`,
        });
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
      if (localRow.status === "expired" || localRow.status === "failed") {
        return jsonResponse(410, { error: "This checkout has expired. Start a new checkout to purchase the item." });
      }

      const { response: retrieve, payload: sessionJson } = await retrievePaymongoSession(
        secretKey,
        checkoutSessionId,
      );
      if (!retrieve.ok) {
        return jsonResponse(retrieve.status, {
          error: paymongoErrorMessage(sessionJson, "Could not retrieve the PayMongo session."),
        });
      }

      const session = sessionJson.data;
      if (!isPaidSession(session)) {
        const sessionStatus = (session?.attributes || session)?.status;
        if (sessionStatus === "expired") {
          const { error: releaseError } = await adminClient.rpc(
            "release_paymongo_checkout_reservation",
            { p_checkout_id: localRow.id, p_status: "expired" },
          );
          if (releaseError) return jsonResponse(500, { error: releaseError.message });
          return jsonResponse(410, { error: "This PayMongo checkout has expired. Start a new checkout." });
        }
        return jsonResponse(402, { error: "Payment is not complete yet. Finish checkout on PayMongo and return here." });
      }

      const result = await fulfillPaidCheckout(adminClient, localRow.id);

      return jsonResponse(200, {
        success: true,
        order_ids: result.order_ids,
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
