import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

export function LockerQrScanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    let stopScanning: (() => void) | undefined;

    void import('@zxing/browser').then(({ BrowserMultiFormatReader }) => {
      if (!active) return;
      const reader = new BrowserMultiFormatReader();
      return reader.decodeFromVideoDevice(undefined, video, (result, _error, controls) => {
        stopScanning = () => controls.stop();
        if (result && active) {
          active = false;
          controls.stop();
          onScan(result.getText());
        }
      }).then((controls) => {
        if (!active) controls.stop();
        else stopScanning = () => controls.stop();
      });
    }).catch((error: unknown) => {
      if (active) setCameraError(error instanceof Error ? error.message : 'Camera access is unavailable.');
    });

    return () => {
      active = false;
      stopScanning?.();
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Scan locker QR code">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-sage-700" />
            <h2 className="font-serif text-lg font-bold text-ink-900">Scan locker QR code</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-ink-100" aria-label="Close QR scanner">
            <X className="h-4 w-4" />
          </button>
        </div>
        <video ref={videoRef} className="aspect-video w-full rounded-xl bg-black object-cover" muted playsInline />
        <p className="mt-3 text-sm text-ink-500">Point the camera at the buyer’s locker drop-off QR code.</p>
        {cameraError && <p role="alert" className="mt-3 rounded-lg bg-terracotta-50 p-3 text-xs text-terracotta-700">{cameraError}</p>}
      </div>
    </div>
  );
}
