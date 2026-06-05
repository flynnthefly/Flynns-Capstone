function strokeToPolygon(points, width, scale = 100) {
    if (!points || points.length == 0) return [];

    // ClipperLib is integer-based so we need to scale up floating-point coordinates and back down after.
    // Clipper2 supports floating-point paths but requires some setup to use.
    // The former simply needs a <script> tag and works just as well for what we want to achieve.
    const toClipperPoint = (p) => ({ X: p.x * scale, Y: p.y * scale });
    const fromClipperPoint = (p) => ({ x: p.X / scale, y: p.Y / scale });

    const path = points.map(toClipperPoint);

    // Offset path to get the edge of the stroke.
    const co = new ClipperLib.ClipperOffset();
    co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound);

    const solution = new ClipperLib.Paths();
    co.Execute(solution, (width / 2) * scale);

    if (solution.length === 0) return [];

    return solution[0].map(fromClipperPoint);
}

function drawPolygon(polygon, ctx) {
  if (!polygon || polygon.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(polygon[0].x, polygon[0].y);
  for (let i = 1; i < polygon.length; i++) {
    ctx.lineTo(polygon[i].x, polygon[i].y);
  }

  const first = polygon[0];
  const last = polygon[polygon.length - 1];
  const dx = Math.abs(first.x - last.x);
  const dy = Math.abs(first.y - last.y);
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.5) ctx.closePath();

  ctx.stroke();
}

function drawPolyline(points, ctx) {
  if (!points || points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

// remove segments of an open stroke that fall inside eraserPolygon
function erasePolyline(poly, eraserPolygon, sampleStep = 3) {
  if (!poly || poly.length < 2) return [];
  const pieces = [];
  let cur = [];

  const push = (p) => {
    if (!cur.length || Math.hypot(p.x - cur[cur.length - 1].x, p.y - cur[cur.length - 1].y) > 0.25) {
      cur.push(p);
    }
  };
  const commit = () => { if (cur.length > 1) pieces.push(cur.slice()); cur = []; };

  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i+1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(L / sampleStep));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const inside = isPointInPolygon(p, eraserPolygon);
      if (!inside) push(p); else commit();
    }
  }
  commit();
  return pieces;
}


function normalizeClipperPath(path, scale = 100) {
  if (path.length >= 2) {
    const a = path[path.length - 1], b = path[0];
    if (a.X === b.X && a.Y === b.Y) path = path.slice(0, -1);
  }
  return path.map(p => ({ x: p.X / scale, y: p.Y / scale }));
}

function closeIfUserClosed(points, tol = 8) {
  if (!points || points.length < 3) return points;
  const a = points[0], b = points[points.length - 1];
  const dx = a.x - b.x, dy = a.y - b.y;
  const d2 = dx*dx + dy*dy;
  if (d2 <= tol*tol) {
    const copy = points.slice(0, -1);
    copy.push({ x: a.x, y: a.y });
    return copy;
  }
  return points;
}

function isPointInPolygon(point, polygon) {
    let x = point.x, y = point.y;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;

        const intersect = ((yi > y) !== (yj > y)) &&
                          (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }

    return inside;
}

function isPointNearPolyline(pt, polyline, tolPx) {
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i], b = polyline[i+1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx*dx + dy*dy || 1;
    let t = ((pt.x - a.x)*dx + (pt.y - a.y)*dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t*dx, py = a.y + t*dy;
    const dist2 = (pt.x - px)**2 + (pt.y - py)**2;
    if (dist2 <= tolPx*tolPx) return true;
  }
  return false;
}


function highlightPolygon(polygon, polygons, ctx) {
    if (!polygons) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    for (const p of polygons) {
        const prev_colour = ctx.strokeStyle;
        if (p === polygon) ctx.strokeStyle = 'yellow';
        drawPolyline(p, ctx);
        ctx.strokeStyle = prev_colour;
    }
}

function subtractPolygons(subjectPolygon, clipPolygon, scale = 100) {
    if (!subjectPolygon || subjectPolygon.length === 0) return [];
    if (!clipPolygon || clipPolygon.length === 0) return [subjectPolygon];

    // Ensure polygons are closed and have proper winding
    const subjectClosed = ensureClosedPolygon(subjectPolygon);
    const clipClosed = ensureClosedPolygon(clipPolygon);

    // Convert to ClipperLib format
    const toClipperPoint = (p) => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) });
    const fromClipperPoint = (p) => ({ x: p.X / scale, y: p.Y / scale });

    const subjectPath = subjectClosed.map(toClipperPoint);
    const clipPath = clipClosed.map(toClipperPoint);

    // Perform boolean subtraction
    const clipper = new ClipperLib.Clipper();
    clipper.AddPath(subjectPath, ClipperLib.PolyType.ptSubject, true);
    clipper.AddPath(clipPath, ClipperLib.PolyType.ptClip, true);

    //comment
    const solution = new ClipperLib.Paths();
    const success = clipper.Execute(ClipperLib.ClipType.ctDifference, solution);

    if (!success || solution.length === 0) {
        return []; // No valid result
    }

    // Convert back to our format and clean up
    const result = solution.map(path => {
        const cleaned = path.map(fromClipperPoint);
        return ensureClosedPolygon(cleaned);
    });

    return result;
}

function ensureClosedPolygon(polygon) {
    if (!polygon || polygon.length < 3) return polygon;
    
    // Check if polygon is already closed
    const first = polygon[0];
    const last = polygon[polygon.length - 1];
    const isClosed = Math.abs(first.x - last.x) < 0.1 && Math.abs(first.y - last.y) < 0.1;
    
    if (isClosed) {
        return polygon;
    } else {
        // Close the polygon by adding the first point at the end
        return [...polygon, { x: first.x, y: first.y }];
    }
}

function polygonsIntersect(poly1, poly2) {
    // Simple bounding box intersection check first
    const bounds1 = getPolygonBounds(poly1);
    const bounds2 = getPolygonBounds(poly2);
    
    if (bounds1.maxX < bounds2.minX || bounds2.maxX < bounds1.minX ||
        bounds1.maxY < bounds2.minY || bounds2.maxY < bounds1.minY) {
        return false;
    }
    
    // Check if any point of poly1 is inside poly2 or vice versa
    for (const point of poly1) {
        if (isPointInPolygon(point, poly2)) return true;
    }
    for (const point of poly2) {
        if (isPointInPolygon(point, poly1)) return true;
    }
    
    return false;
}

function getPolygonBounds(polygon) {
    if (!polygon || polygon.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    
    let minX = polygon[0].x, minY = polygon[0].y, maxX = polygon[0].x, maxY = polygon[0].y;
    
    for (const point of polygon) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }
    
    return { minX, minY, maxX, maxY };
}

function getPolygonArea(polygon) {
    if (!polygon || polygon.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        area += polygon[i].x * polygon[j].y;
        area -= polygon[j].x * polygon[i].y;
    }
    return Math.abs(area) / 2;
}

function getPolygonCoverage(subjectPolygon, clipPolygon) {
    if (!subjectPolygon || subjectPolygon.length < 3) return 0;
    if (!clipPolygon || clipPolygon.length < 3) return 0;
    
    // Get bounding box of subject polygon
    const bounds = getPolygonBounds(subjectPolygon);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    
    // Sample points within the subject polygon
    const sampleSize = Math.min(100, Math.max(10, Math.floor(width * height / 1000)));
    let pointsInside = 0;
    let pointsInEraser = 0;
    
    for (let i = 0; i < sampleSize; i++) {
        // Generate random point within bounding box
        const x = bounds.minX + Math.random() * width;
        const y = bounds.minY + Math.random() * height;
        const point = { x, y };
        
        // Check if point is inside subject polygon
        if (isPointInPolygon(point, subjectPolygon)) {
            pointsInside++;
            // Check if point is also inside eraser polygon
            if (isPointInPolygon(point, clipPolygon)) {
                pointsInEraser++;
            }
        }
    }
    
    if (pointsInside === 0) return 0;
    return (pointsInEraser / pointsInside) * 100;
}

function erasePolyline(poly, eraserPolygon, sampleStep = 4) {
  if (!poly || poly.length < 2) return [];

  const pieces = [];
  let cur = [];

  const push = (p) => {
    // avoid micro-duplicates
    if (!cur.length || Math.hypot(p.x - cur[cur.length - 1].x, p.y - cur[cur.length - 1].y) > 0.3) {
      cur.push(p);
    }
  };
  const commit = () => {
    if (cur.length > 1) pieces.push(cur.slice());
    cur = [];
  };

  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(L / sampleStep));

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const inside = isPointInPolygon(p, eraserPolygon);

      if (!inside) {
        push(p);
      } else {
        // we just hit eraser; end current piece
        commit();
      }
    }
  }
  commit();
  return pieces;
}

function cutPolygonWithEraser(subjectPolygon, eraserPolygon) {
    if (!subjectPolygon || subjectPolygon.length < 3) return [];
    if (!eraserPolygon || eraserPolygon.length < 3) return [subjectPolygon];
    
    // Find intersection points between the polygons
    const intersectionPoints = findPolygonIntersections(subjectPolygon, eraserPolygon);
    
    if (intersectionPoints.length === 0) {
        // No intersections, check if eraser is completely inside or outside
        const centerPoint = getPolygonCenter(subjectPolygon);
        if (isPointInPolygon(centerPoint, eraserPolygon)) {
            return []; // Eraser completely covers the polygon
        } else {
            return [subjectPolygon]; // No intersection, keep original
        }
    }
    
    // Create cuts at intersection points
    const cutPolygons = createCutsAtIntersections(subjectPolygon, eraserPolygon, intersectionPoints);
    
    // Filter out polygons that are mostly inside the eraser
    return cutPolygons.filter(polygon => {
        const center = getPolygonCenter(polygon);
        return !isPointInPolygon(center, eraserPolygon);
    });
}

function findPolygonIntersections(poly1, poly2) {
    const intersections = [];
    
    for (let i = 0; i < poly1.length; i++) {
        const p1 = poly1[i];
        const p2 = poly1[(i + 1) % poly1.length];
        
        for (let j = 0; j < poly2.length; j++) {
            const p3 = poly2[j];
            const p4 = poly2[(j + 1) % poly2.length];
            
            const intersection = lineIntersection(p1, p2, p3, p4);
            if (intersection) {
                intersections.push(intersection);
            }
        }
    }
    
    return intersections;
}

function lineIntersection(p1, p2, p3, p4) {
    const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;
    
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null; // Lines are parallel
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return {
            x: x1 + t * (x2 - x1),
            y: y1 + t * (y2 - y1)
        };
    }
    
    return null;
}

function getPolygonCenter(polygon) {
    if (!polygon || polygon.length === 0) return { x: 0, y: 0 };
    
    let sumX = 0, sumY = 0;
    for (const point of polygon) {
        sumX += point.x;
        sumY += point.y;
    }
    
    return {
        x: sumX / polygon.length,
        y: sumY / polygon.length
    };
}

function filterPolygonPoints(subjectPolygon, eraserPolygon) {
    if (!subjectPolygon || subjectPolygon.length < 3) return [];
    if (!eraserPolygon || eraserPolygon.length < 3) return [subjectPolygon];
    
    // Filter out points that are inside the eraser polygon
    const filteredPoints = subjectPolygon.filter(point => 
        !isPointInPolygon(point, eraserPolygon)
    );
    
    if (filteredPoints.length < 3) {
        // Not enough points to form a polygon
        return [];
    }
    
    // Check if we need to create multiple separate polygons
    const result = createSeparatePolygons(filteredPoints, eraserPolygon);
    
    return result;
}

function createSeparatePolygons(points, eraserPolygon) {
    if (points.length < 3) return [];
    
    // Group points that are close together to form separate polygons
    const groups = [];
    let currentGroup = [points[0]];
    
    for (let i = 1; i < points.length; i++) {
        const currentPoint = points[i];
        const lastPoint = currentGroup[currentGroup.length - 1];
        
        // Calculate distance between consecutive points
        const distance = Math.sqrt(
            Math.pow(currentPoint.x - lastPoint.x, 2) + 
            Math.pow(currentPoint.y - lastPoint.y, 2)
        );
        
        if (distance < 50) { // Points are close together
            currentGroup.push(currentPoint);
        } else {
            // Start a new group
            if (currentGroup.length >= 3) {
                groups.push([...currentGroup]);
            }
            currentGroup = [currentPoint];
        }
    }
    
    // Add the last group
    if (currentGroup.length >= 3) {
        groups.push([...currentGroup]);
    }
    
    // Filter out groups that are too small or mostly inside the eraser
    return groups.filter(group => {
        if (group.length < 3) return false;
        
        const area = getPolygonArea(group);
        if (area < 100) return false;
        
        // Check if the group center is inside the eraser
        const center = getPolygonCenter(group);
        if (isPointInPolygon(center, eraserPolygon)) return false;
        
        return true;
    });
}

function subtractPolygonsClean(subjectPolygon, clipPolygon, scale = 100) {
  if (!subjectPolygon || subjectPolygon.length < 3) return [];
  if (!clipPolygon   || clipPolygon.length   < 3) return [subjectPolygon];

  const subject = cleanPolygon(ensureClosedPolygon(subjectPolygon));
  const clip    = cleanPolygon(ensureClosedPolygon(clipPolygon));
  if (subject.length < 3 || clip.length < 3) return [subjectPolygon];

  const toPath = pts => pts.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));

  let subjPath = toPath(subject);
  let clipPath = toPath(clip);

  if (!ClipperLib.Clipper.Orientation(subjPath)) subjPath.reverse();
  if (ClipperLib.Clipper.Orientation(clipPath)) clipPath.reverse();

  const c = new ClipperLib.Clipper();
  c.AddPath(subjPath, ClipperLib.PolyType.ptSubject, true);
  c.AddPath(clipPath, ClipperLib.PolyType.ptClip,    true);

  const solution = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctDifference, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  if (!solution.length) return [];

  // normalize & drop tiny fragments
  return solution
    .map(path => cleanPolygon(normalizeClipperPath(path, scale)))
    .filter(p => p.length >= 3 && getPolygonArea(p) > 25);
}

function cleanPolygon(polygon) {
    if (!polygon || polygon.length < 3) return polygon;
    
    // Remove duplicate consecutive points
    const cleaned = [];
    for (let i = 0; i < polygon.length; i++) {
        const current = polygon[i];
        const next = polygon[(i + 1) % polygon.length];
        
        const dx = Math.abs(current.x - next.x);
        const dy = Math.abs(current.y - next.y);
        
        if (dx > 0.1 || dy > 0.1) {
            cleaned.push(current);
        }
    }
    
    // Ensure polygon is closed
    if (cleaned.length >= 3) {
        const first = cleaned[0];
        const last = cleaned[cleaned.length - 1];
        if (Math.abs(first.x - last.x) > 0.1 || Math.abs(first.y - last.y) > 0.1) {
            cleaned.push({ x: first.x, y: first.y });
        }
    }
    
    return cleaned;
}

function createPolygonsOutsideEraser(subjectPolygon, eraserPolygon) {
    // Sample points around the polygon boundary to find parts outside the eraser
    const outsidePoints = [];
    const step = 5; // Sample every 5 pixels along the boundary
    
    for (let i = 0; i < subjectPolygon.length; i++) {
        const p1 = subjectPolygon[i];
        const p2 = subjectPolygon[(i + 1) % subjectPolygon.length];
        
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.floor(length / step));
        
        for (let j = 0; j <= steps; j++) {
            const t = j / steps;
            const point = {
                x: p1.x + t * dx,
                y: p1.y + t * dy
            };
            
            if (!isPointInPolygon(point, eraserPolygon)) {
                outsidePoints.push(point);
            }
        }
    }
    
    if (outsidePoints.length < 3) {
        return []; // Not enough points to form a polygon
    }
    
    // Create a simplified polygon from the outside points
    return [simplifyPolygon(outsidePoints)];
}

function splitPolygonAtEraser(subjectPolygon, eraserPolygon) {
    // Find the intersection points and create cuts
    const intersectionPoints = findPolygonIntersections(subjectPolygon, eraserPolygon);
    
    if (intersectionPoints.length < 2) {
        // Not enough intersection points for a meaningful split
        const center = getPolygonCenter(subjectPolygon);
        if (isPointInPolygon(center, eraserPolygon)) {
            return []; // Remove if center is inside
        } else {
            return [subjectPolygon]; // Keep if center is outside
        }
    }
    
    // For now, use a simple approach based on center point
    const center = getPolygonCenter(subjectPolygon);
    if (isPointInPolygon(center, eraserPolygon)) {
        return []; // Remove the polygon
    } else {
        return [subjectPolygon]; // Keep the polygon
    }
}

function simplifyPolygon(points) {
    if (points.length <= 3) return points;
    
    // Simple polygon simplification - keep every nth point
    const step = Math.max(1, Math.floor(points.length / 20)); // Keep max 20 points
    const simplified = [];
    
    for (let i = 0; i < points.length; i += step) {
        simplified.push(points[i]);
    }
    
    // Ensure the polygon is closed
    if (simplified.length > 0) {
        const first = simplified[0];
        const last = simplified[simplified.length - 1];
        if (Math.abs(first.x - last.x) > 1 || Math.abs(first.y - last.y) > 1) {
            simplified.push({ x: first.x, y: first.y });
        }
    }
    
    return simplified;
}