/*!
 * OpenHistoria Beta Map Editor - validated scissors cut.
 *
 * Split a polygon into two disjoint coverages using a drawn, non-self-crossing
 * polyline. The cutter is extended to an enclosing rectangle; two complementary
 * exterior paths are intersected with the target via polygon-clipping.
 * The original region's stable ID stays with the larger piece; a new ID is
 * assigned only to the smaller piece. Invalid cuts fail before mutation.
 */
import polygonClipping from "polygon-clipping";
import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import MultiPolygon from "ol/geom/MultiPolygon.js";
import { planarGeometryArea } from "./geometry.js";
import { restoreCarvedEdited } from "./regionCarveHistory.js";

const coordsOf = (geometry) =>
  geometry.getType() === "Polygon" ? [geometry.getCoordinates()] : geometry.getCoordinates();

const asGeometry = (coords) =>
  coords.length === 1 ? new Polygon(coords[0]) : new MultiPolygon(coords);

const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const intersectsProper = (a,b,c,d) => {
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  return (abC*abD<0 && cdA*cdB<0);
};
const validPath = (points) => {
  if (!Array.isArray(points) || points.length < 2 || points.length > 4000) return false;
  for (let i=0;i<points.length;i++) {
    if (!Array.isArray(points[i]) || points[i].length<2 ||
        !Number.isFinite(points[i][0]) || !Number.isFinite(points[i][1])) return false;
    if (i && Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1])<1e-8) return false;
  }
  for (let i=0;i<points.length-1;i++) {
    for (let j=i+2;j<points.length-1;j++) {
      if (intersectsProper(points[i],points[i+1],points[j],points[j+1])) return false;
    }
  }
  return true;
};

const rayExit = (point, other, [xmin,ymin,xmax,ymax]) => {
  const dx=point[0]-other[0],dy=point[1]-other[1],hits=[];
  if (dx !== 0) {
    for (const x of [xmin,xmax]) {
      const t=(x-point[0])/dx,y=point[1]+t*dy;
      if (t>0 && y>=ymin-1e-6 && y<=ymax+1e-6) hits.push({t,point:[x,Math.max(ymin,Math.min(ymax,y))]});
    }
  }
  if (dy !== 0) {
    for (const y of [ymin,ymax]) {
      const t=(y-point[1])/dy,x=point[0]+t*dx;
      if (t>0 && x>=xmin-1e-6 && x<=xmax+1e-6) hits.push({t,point:[Math.max(xmin,Math.min(xmax,x)),y]});
    }
  }
  hits.sort((a,b)=>a.t-b.t);
  return hits[0]?.point ?? null;
};

const boundaryPath = (from,to,[xmin,ymin,xmax,ymax]) => {
  const w=xmax-xmin,h=ymax-ymin,P=2*(w+h);
  const along = ([x,y]) => {
    if (y===ymin) return x-xmin;
    if (x===xmax) return w+y-ymin;
    if (y===ymax) return w+h+xmax-x;
    if (x===xmin) return 2*w+h+ymax-y;
    throw new Error("Scissors endpoint does not reach the enclosing rectangle.");
  };
  const t0=along(from),t1=along(to);
  const stop=t1<=t0?t1+P:t1;
  const corners=[
    [w,[xmax,ymin]],
    [w+h,[xmax,ymax]],
    [2*w+h,[xmin,ymax]],
    [P,[xmin,ymin]],
  ];
  const nodes=[];
  for (const [t,p] of corners) {
    for (const k of [0,1]) {
      const at=t+k*P;
      if (at>t0+1e-8 && at<stop-1e-8) nodes.push([at,p]);
    }
  }
  nodes.sort((a,b)=>a[0]-b[0]);
  return [from,...nodes.map(([,p])=>p),to];
};

export const splitGeometryByLine = (geometry, rawPoints) => {
  if (!geometry || !["Polygon","MultiPolygon"].includes(geometry.getType?.())) return null;
  const points = rawPoints?.map((p)=>Array.isArray(p)?p.slice(0,2):p);
  if (!validPath(points)) return null;
  const extent=geometry.getExtent();
  if (!extent.every(Number.isFinite)) return null;
  const xmin=Math.min(extent[0],...points.map((p)=>p[0]));
  const ymin=Math.min(extent[1],...points.map((p)=>p[1]));
  const xmax=Math.max(extent[2],...points.map((p)=>p[0]));
  const ymax=Math.max(extent[3],...points.map((p)=>p[1]));
  const pad=Math.max(10,Math.max(xmax-xmin,ymax-ymin)*0.1);
  const bounds=[xmin-pad,ymin-pad,xmax+pad,ymax+pad];
  const a=rayExit(points[0],points[1],bounds);
  const z=rayExit(points[points.length-1],points[points.length-2],bounds);
  if (!a || !z || Math.hypot(a[0]-z[0],a[1]-z[1])<1e-7) return null;
  const line=[a,...points,z];
  if (!validPath(line)) return null;
  const forward=boundaryPath(z,a,bounds);
  const backward=boundaryPath(a,z,bounds).reverse();
  const first=[...line,...forward.slice(1)];
  const second=[...line,...backward.slice(1)];
  const original=coordsOf(geometry);
  let left,right;
  try {
    const l=polygonClipping.intersection(original,[first]);
    const rr=polygonClipping.intersection(original,[second]);
    if (!l?.length || !rr?.length) return null;
    left=asGeometry(l);
    right=asGeometry(rr);
  } catch {
    return null; // malformed/crossed path must not mutate a canonical region
  }
  const total=planarGeometryArea(geometry);
  const firstArea=planarGeometryArea(left),secondArea=planarGeometryArea(right);
  const minPiece=Math.max(1e-4,total*1e-8);
  if (firstArea<=minPiece || secondArea<=minPiece ||
      Math.abs(firstArea+secondArea-total)>Math.max(0.01,total*1e-6)) return null;
  return firstArea>=secondArea ? [left,right] : [right,left];
};

export const splitRegionFeature = (source, original, points, makeId) => {
  if (!source || !original || source.getFeatureById(original.getId())!==original) return null;
  const geometry=original.getGeometry();
  const parts=splitGeometryByLine(geometry,points);
  if (!parts) return null;
  const id=String(makeId?.() ?? "");
  if (!id || source.getFeatureById(id)) return null;
  const props={...original.getProperties()};
  delete props.geometry;
  delete props.id;
  // A newly drawn piece is not stock GADM geometry or the original geographic
  // provenance; inherited claims, owner, type and group remain authored facts.
  for (const field of Object.keys(props)) if (/^gid\d*$/i.test(field)) delete props[field];
  props.gid0="";
  props.name=`${String(original.get("name")||"Region")} (split)`;
  props.edited=true;
  if (Array.isArray(props.claimants)) props.claimants=props.claimants.slice();
  const created=new Feature({...props,geometry:parts[1].clone()});
  created.setId(id);
  const before=geometry.clone(), edited=original.get("edited");
  const apply=()=>{
    original.setGeometry(parts[0].clone());
    original.set("edited",true);
    source.addFeature(created);
  };
  try { apply(); }
  catch {
    if (source.getFeatureById(id)===created) source.removeFeature(created);
    original.setGeometry(before.clone());
    restoreCarvedEdited(original,edited);
    return null;
  }
  return {
    createdId:id,
    retainedId:original.getId(),
    undo:()=>{
      source.removeFeature(created);
      original.setGeometry(before.clone());
      restoreCarvedEdited(original,edited);
    },
    redo:apply,
  };
};
