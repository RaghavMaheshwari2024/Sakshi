/** Satellite map for matching road points to the camera frame. */
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
}

interface SatelliteMapProps {
  pins: MapPin[];
  /** Where to look; changing it moves the map. */
  target: [number, number] | null;
  armed: boolean;
  onPick: (lat: number, lng: number, zoom: number) => void;
  onMovePin: (id: string, lat: number, lng: number, zoom: number) => void;
}

const SatelliteMap: React.FC<SatelliteMapProps> = ({ pins, target, armed, onPick, onMovePin }) => {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const latest = useRef({ armed, onPick, onMovePin });
  latest.current = { armed, onPick, onMovePin };

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { maxZoom: 21 }).setView(pins[0] ? [pins[0].lat, pins[0].lng] : [22.5, 79], pins[0] ? 19 : 5);
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 19, maxZoom: 21, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    });
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19, maxZoom: 21, attribution: '© OpenStreetMap contributors',
    });
    satellite.addTo(m);
    L.control.layers({ Satellite: satellite, Streets: streets }, undefined, { position: 'topright' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (latest.current.armed) latest.current.onPick(e.latlng.lat, e.latlng.lng, m.getZoom());
    });
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // The map is created once; pins and target follow through their own effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (m && target) m.setView(target, Math.max(m.getZoom(), 18));
  }, [target]);

  useEffect(() => {
    if (map.current) map.current.getContainer().style.cursor = armed ? 'crosshair' : '';
  }, [armed]);

  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    pins.forEach((p) => {
      const marker = L.marker([p.lat, p.lng], {
        draggable: true,
        icon: L.divIcon({
          className: '',
          iconSize: [26, 18],
          iconAnchor: [13, 9],
          html: `<div style="background:#f2c037;color:#0a0b0c;font:600 11px 'IBM Plex Mono',monospace;border-radius:3px;text-align:center;line-height:18px">${p.id}</div>`,
        }),
      });
      marker.on('dragend', () => {
        const at = marker.getLatLng();
        latest.current.onMovePin(p.id, at.lat, at.lng, map.current?.getZoom() ?? 19);
      });
      group.addLayer(marker);
    });
  }, [pins]);

  return <div ref={el} className="h-[300px] w-full rounded border border-line" aria-label="Satellite map. Click the road point that matches the point on the frame." />;
};

export default SatelliteMap;
