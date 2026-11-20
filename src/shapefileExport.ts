import JSZip from 'jszip';
import writeShapefile from '@mapbox/shp-write/src/write.js';
import { booleanClockwise } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

type PolygonFeature = Feature<Polygon | MultiPolygon>;

function isValidRing(ring: unknown): ring is Position[] {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(position =>
    Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1])
  )) return false;
  const last = ring[ring.length - 1];
  return ring[0][0] === last[0] && ring[0][1] === last[1];
}

function isPolygonFeature(feature: unknown): feature is PolygonFeature {
  const candidate = feature as PolygonFeature | null;
  if (candidate?.type !== 'Feature' || !candidate.geometry) return false;
  const { type, coordinates } = candidate.geometry;
  if (type !== 'Polygon' && type !== 'MultiPolygon') return false;
  const polygons = type === 'Polygon' ? [coordinates] : coordinates;
  return Array.isArray(polygons) && polygons.length > 0 && polygons.every(polygon =>
    Array.isArray(polygon) && polygon.length > 0 && polygon.every(isValidRing)
  );
}

export function getExportFeatures(collection: unknown): PolygonFeature[] | null {
  const value = collection as { type?: string; features?: unknown[] } | null;
  if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features) ||
    !value.features.length || !value.features.every(isPolygonFeature)) return null;
  return value.features;
}

export async function zipShapefile(features: PolygonFeature[]): Promise<ArrayBuffer> {
  const geometries = features.map(feature => {
    // SHP uses clockwise exterior rings and counterclockwise holes.
    const { geometry } = feature;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.flatMap(polygon => polygon.map((ring, index) =>
      booleanClockwise(ring) === (index === 0) ? ring : [...ring].reverse()
    ));
  });
  const rows = features.map(feature => feature.properties ?? {});
  interface ShapefileParts {
    shp: DataView;
    shx: DataView;
    dbf: DataView;
    prj: string;
  }
  const files = await new Promise<ShapefileParts>((resolve, reject) => {
    writeShapefile(rows, 'POLYGON', geometries, (error: unknown, files: ShapefileParts) => {
      if (error) reject(error);
      else resolve(files);
    });
  });

  // Use the final index entry to exclude the writer's trailing padding.
  const lastIndex = files.shx.byteLength - 8;
  const shpLength = (files.shx.getInt32(lastIndex) + 4 + files.shx.getInt32(lastIndex + 4)) * 2;
  files.shp.setInt32(24, shpLength / 2);

  const zip = new JSZip();
  zip.file('fire_isochrones.shp', new Uint8Array(files.shp.buffer, files.shp.byteOffset, shpLength));
  zip.file('fire_isochrones.shx', new Uint8Array(files.shx.buffer, files.shx.byteOffset, files.shx.byteLength));
  zip.file('fire_isochrones.dbf', new Uint8Array(files.dbf.buffer, files.dbf.byteOffset, files.dbf.byteLength));
  zip.file('fire_isochrones.prj', files.prj);
  return zip.generateAsync({ type: 'arraybuffer' });
}
