// ============================================================
// KISAN-KAVACH — Crop Map with NDVI Overlay
// ============================================================

import React from 'react';
import { MapContainer, TileLayer, Rectangle, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface CropMapProps {
  lat:      number;
  lng:      number;
  acres:    number;
  cropType: string;
}

export default function CropMap({ lat, lng, acres, cropType }: CropMapProps) {
  // Calculate field bounds (5 acres ≈ 0.008 degrees square)
  const offset = 0.004;
  const bounds: [[number, number], [number, number]] = [
    [lat - offset, lng - offset],
    [lat + offset, lng + offset],
  ];

  return (
    <MapContainer
      center={[lat, lng]}
      zoom={16}
      style={{ width: '100%', height: 280 }}
      zoomControl={false}
      attributionControl={false}
    >
      {/* Base map */}
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {/* NDVI overlay (green = healthy vegetation) */}
      <Rectangle
        bounds={bounds}
        pathOptions={{
          color: '#16a34a',
          fillColor: '#22c55e',
          fillOpacity: 0.25,
          weight: 2,
          dashArray: '4 4',
        }}
      />

      {/* Field marker */}
      <Marker position={[lat, lng]}>
        <Popup>
          <div style={{ textAlign: 'center', padding: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>
              {cropType} Field
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              {acres} acres · NDVI: Healthy
            </div>
          </div>
        </Popup>
      </Marker>
    </MapContainer>
  );
}
