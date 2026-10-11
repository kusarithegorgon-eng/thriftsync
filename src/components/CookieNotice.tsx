import { useEffect, useState } from 'react';
import { useRouter } from '@/lib/router';

const NOTICE_KEY = 'thriftsync-essential-storage-notice-v1';
const OPEN_SETTINGS_EVENT = 'thriftsync:open-cookie-settings';

export function CookieNotice() {
  const { navigate } = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(NOTICE_KEY) !== 'seen');
    } catch {
      setVisible(true);
    }

    const openSettings = () => setVisible(true);
    window.addEventListener(OPEN_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(NOTICE_KEY, 'seen');
    } catch {
      // The notice can still be dismissed for this visit if browser storage is disabled.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside
      aria-label="Cookie and browser storage notice"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-ink-200 bg-white shadow-2xl"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-ink-900">Essential browser storage</h2>
          <p className="text-xs leading-relaxed text-ink-600 mt-1">
            ThriftSync uses local storage to keep you signed in and remember your cart. The current
            app does not use analytics or advertising cookies.{' '}
            <button
              onClick={() => navigate({ name: 'legal', document: 'cookies' })}
              className="underline text-terracotta-700 hover:text-terracotta-800"
            >
              Read our Cookie Notice
            </button>
            .
          </p>
        </div>
        <button onClick={dismiss} className="btn-primary shrink-0">
          Continue with essential storage
        </button>
      </div>
    </aside>
  );
}
