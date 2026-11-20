import { supabase } from './supabase';

export type PaymongoCreateInput = {
  items: { listing_id: string; amount: number; title?: string }[];
  shipping_address: string;
  voucher_code: string | null;
  delivery_method: 'courier' | 'pickup' | 'locker';
  locker_location_id: string | null;
  payment_method: 'gcash' | 'all';
  success_url: string;
  cancel_url: string;
};

export type PaymongoConfirmResult = {
  success: boolean;
  already_fulfilled?: boolean;
  order_ids?: string[];
  discount_amount?: number;
};

export type SellerEmailNotification = {
  status: 'sent' | 'not_configured' | 'failed';
  sent_count?: number;
  message?: string;
};

function invokeError(error: { message?: string } | null, data: unknown, fallback: string) {
  if (error?.message) return new Error(error.message);
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
    return new Error((data as { error: string }).error);
  }
  return new Error(fallback);
}

export async function createPaymongoCheckout(input: PaymongoCreateInput) {
  const { data, error } = await supabase.functions.invoke('paymongo-checkout', {
    body: { action: 'create', ...input },
  });
  if (error || !data?.checkout_url || !data?.checkout_session_id) {
    throw invokeError(
      error,
      data,
      'Unable to start PayMongo checkout. Deploy the paymongo-checkout function and set PAYMONGO_SECRET_KEY as a Supabase secret.',
    );
  }
  return data as { checkout_url: string; checkout_session_id: string };
}

export async function createAuctionPaymongoCheckout(input: {
  order_id: string;
  success_url: string;
  cancel_url: string;
}) {
  const { data, error } = await supabase.functions.invoke('paymongo-checkout', {
    body: { action: 'create_auction_payment', ...input },
  });
  if (error || !data?.checkout_url || !data?.checkout_session_id) {
    throw invokeError(error, data, 'Unable to start the auction payment. Try again or contact support.');
  }
  return data as { checkout_url: string; checkout_session_id: string };
}

export async function confirmPaymongoCheckout(checkoutSessionId: string) {
  const { data, error } = await supabase.functions.invoke('paymongo-checkout', {
    body: { action: 'confirm', checkout_session_id: checkoutSessionId },
  });
  if (error || !data?.success) {
    throw invokeError(error, data, 'PayMongo payment could not be confirmed.');
  }
  return data as PaymongoConfirmResult;
}

export async function cancelPaymongoCheckout(checkoutSessionId: string) {
  const { data, error } = await supabase.functions.invoke('paymongo-checkout', {
    body: { action: 'cancel', checkout_session_id: checkoutSessionId },
  });
  if (error || !data?.success) {
    throw invokeError(error, data, 'PayMongo checkout could not be safely cancelled.');
  }
  return data as { success: true; cancelled?: boolean; order_already_created?: boolean; order_ids?: string[] };
}

export async function simulateGcashCheckout(input: Omit<PaymongoCreateInput, 'payment_method' | 'success_url' | 'cancel_url'>) {
  const { data, error } = await supabase.functions.invoke('paymongo-checkout', {
    body: { action: 'simulate_gcash', ...input },
  });
  if (error || !data?.success || !Array.isArray(data?.order_ids)) {
    throw invokeError(error, data, 'GCash demo checkout could not be completed.');
  }
  return data as { success: true; order_ids: string[] };
}

export async function createCashOnDeliveryOrders(
  input: Omit<PaymongoCreateInput, 'payment_method' | 'success_url' | 'cancel_url'>,
) {
  const { data, error } = await supabase.functions.invoke('paymongo-checkout', {
    body: { action: 'create_cash_on_delivery', ...input },
  });
  if (error || !data?.success || !Array.isArray(data?.order_ids)) {
    throw invokeError(error, data, 'Cash-on-receipt checkout could not be completed.');
  }
  return data as { success: true; order_ids: string[] };
}

export async function notifySellerOfOrders(orderIds: string[]): Promise<SellerEmailNotification> {
  try {
    const { data, error } = await supabase.functions.invoke('paymongo-checkout', {
      body: { action: 'notify_sellers', order_ids: orderIds },
    });
    if (error) {
      return { status: 'failed', message: error.message };
    }
    if (!data || typeof data.status !== 'string') {
      return { status: 'failed', message: 'The seller email notification returned an invalid response.' };
    }
    return data as SellerEmailNotification;
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'The seller email notification could not be sent.',
    };
  }
}

export const PAYMONGO_SESSION_KEY = 'thriftsync-paymongo-session';
export const paymongoPublicKey = import.meta.env.VITE_PAYMONGO_PUBLIC_KEY || '';
export const isPaymongoTestMode = paymongoPublicKey.startsWith('pk_test_');
