import { useState, useEffect } from 'react';

interface GeolocationState {
  location: { lat: number; lng: number; accuracy: number } | null;
  error: string | null;
  loading: boolean;
}

export function useGeolocation(): GeolocationState {
  const [state, setState] = useState<GeolocationState>({
    location: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    if (!navigator.geolocation) {
      setState({ location: null, error: 'Geolocation not supported', loading: false });
      return;
    }

    // Use getCurrentPosition (one-shot) instead of watchPosition
    // enableHighAccuracy: false works on HTTP localhost without HTTPS
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
          error: null,
          loading: false,
        });
      },
      (err) => {
        // Don't block the UI — just mark as not loading
        setState({ location: null, error: err.message, loading: false });
      },
      {
        enableHighAccuracy: false,  // Works on HTTP, faster response
        timeout: 8000,
        maximumAge: 30000,          // Accept cached position up to 30s old
      },
    );

    // Also set up a watch for continuous updates after initial fix
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setState({
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
          error: null,
          loading: false,
        });
      },
      () => {
        // Watch errors are non-fatal — we already have the one-shot result
        setState(prev => ({ ...prev, loading: false }));
      },
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 10000,
      },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return state;
}
