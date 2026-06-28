import { environment } from '../../environments/environment';

/**
 * Lazily loads the Google Maps JavaScript SDK (Places + geometry) when an API
 * key is configured. Resolves to `true` once available, or `false` when no key
 * is set so callers can fall back to the backend geo service. Loads the script
 * at most once.
 */
let loadPromise: Promise<boolean> | null = null;

export function loadGoogleMaps(): Promise<boolean> {
  if (!environment.googleMapsApiKey) return Promise.resolve(false);
  if (typeof window !== 'undefined' && (window as unknown as { google?: unknown }).google) {
    return Promise.resolve(true);
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${environment.googleMapsApiKey}&libraries=places,geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return loadPromise;
}
