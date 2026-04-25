import React from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const incidentIcon = L.divIcon({
  className: '',
  html: `<div style="width:14px;height:14px;background:#ff2d2d;border:2px solid #fff;border-radius:50%;box-shadow:0 0 10px #ff2d2d80;"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const responderIcon = L.divIcon({
  className: '',
  html: `<div style="width:10px;height:10px;background:#00ff88;border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px #00ff8880;"></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

interface IncidentMapProps {
  center: { lat: number; lng: number };
  zoom?: number;
  markerPosition?: { lat: number; lng: number };
  responderLocations?: Array<{ responderId: string; lat: number; lng: number }>;
  readonly?: boolean;
}

function MapUpdater({ center, zoom }: { center: { lat: number; lng: number }; zoom: number }) {
  const map = useMap();
  React.useEffect(() => {
    map.setView([center.lat, center.lng], zoom);
  }, [center.lat, center.lng, zoom, map]);
  return null;
}

export function IncidentMap({
  center,
  zoom = 14,
  markerPosition,
  responderLocations = [],
  readonly = false,
}: IncidentMapProps) {
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={zoom}
      style={{ width: '100%', height: '100%' }}
      zoomControl={false}
      dragging={!readonly}
      scrollWheelZoom={!readonly}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution=""
      />
      <MapUpdater center={center} zoom={zoom} />

      {markerPosition && (
        <>
          <Marker position={[markerPosition.lat, markerPosition.lng]} icon={incidentIcon} />
          <Circle
            center={[markerPosition.lat, markerPosition.lng]}
            radius={200}
            pathOptions={{ color: '#ff2d2d', fillColor: '#ff2d2d', fillOpacity: 0.05, weight: 1 }}
          />
        </>
      )}

      {responderLocations.map(r => (
        <Marker
          key={r.responderId}
          position={[r.lat, r.lng]}
          icon={responderIcon}
        />
      ))}
    </MapContainer>
  );
}
