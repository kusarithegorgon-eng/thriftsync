import { supabase } from './supabase';

export type PaymongoCreateInput = {
  items: { listing_id: string; amount: number; title?: string }[];
  shipping_address: string;
  voucher_code: string | null;
  delivery_method: 'courier' | 'pickup' | 'locker';
  locker_location_id: string | null;
  success_url: string;
  cancel_url: string;
};

export type PaymongoConfirmResult = {
  success: boolean;
  already_fulfilled?: boolean;
  order_ids?: string[];
  discount_amount?: number;
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

export async function confirmPaymongoCheckout(checkoutSessionId: string) {
  const { data, error } = await supabase.functions.invoke('paymongo-checkout', {
    body: { action: 'confirm', checkout_session_id: checkoutSessionId },
  });
  if (error || !data?.success) {
    throw invokeError(error, data, 'PayMongo payment could not be confirmed.');
  }
  return data as PaymongoConfirmResult;
}

export const PAYMONGO_SESSION_KEY = 'thriftsync-paymongo-session';
export const paymongoPublicKey = import.meta.env.VITE_PAYMONGO_PUBLIC_KEY || '';
export const isPaymongoTestMode = paymongoPublicKey.startsWith('pk_test_');
