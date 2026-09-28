import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ListingWithBoutique, Voucher } from './supabase';

export type CartItem = {
  listing: ListingWithBoutique;
  quantity: number;
};

type CartContextValue = {
  items: CartItem[];
  addToCart: (listing: ListingWithBoutique) => void;
  removeFromCart: (listingId: string) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
  appliedVoucher: Voucher | null;
  discountAmount: number;
  setAppliedVoucher: (voucher: Voucher | null, discount: number) => void;
  finalTotal: number;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

const STORAGE_KEY = 'thriftsync-cart';
const VOUCHER_KEY = 'thriftsync-voucher';

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [appliedVoucher, setAppliedVoucherState] = useState<Voucher | null>(null);
  const [discountAmount, setDiscountAmount] = useState(0);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setItems(JSON.parse(stored));
      const storedVoucher = localStorage.getItem(VOUCHER_KEY);
      if (storedVoucher) {
        const parsed = JSON.parse(storedVoucher);
        setAppliedVoucherState(parsed.voucher);
        setDiscountAmount(parsed.discount);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore
    }
  }, [items]);

  useEffect(() => {
    try {
      if (appliedVoucher) {
        localStorage.setItem(VOUCHER_KEY, JSON.stringify({ voucher: appliedVoucher, discount: discountAmount }));
      } else {
        localStorage.removeItem(VOUCHER_KEY);
      }
    } catch {
      // ignore
    }
  }, [appliedVoucher, discountAmount]);

  function addToCart(listing: ListingWithBoutique) {
    setItems((prev) => {
      const existing = prev.find((item) => item.listing.id === listing.id);
      if (existing) return prev;
      return [...prev, { listing, quantity: 1 }];
    });
  }

  function removeFromCart(listingId: string) {
    setItems((prev) => prev.filter((item) => item.listing.id !== listingId));
  }

  function clearCart() {
    setItems([]);
    setAppliedVoucherState(null);
    setDiscountAmount(0);
  }

  function setAppliedVoucher(voucher: Voucher | null, discount: number) {
    setAppliedVoucherState(voucher);
    setDiscountAmount(discount);
  }

  const total = items.reduce((sum, item) => sum + Number(item.listing.price), 0);
  const itemCount = items.length;
  const finalTotal = Math.max(0, total - discountAmount);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, clearCart, total, itemCount, appliedVoucher, discountAmount, setAppliedVoucher, finalTotal }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
