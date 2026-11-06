/**
 * calculate simplification data using optimized Douglas-Peucker algorithm
 * @param coords - flat array of coordinates
 * @param first - index of the first coordinate in the segment
 * @param last - index of the last coordinate in the segment
 * @param sqTolerance - square tolerance value
 */
export function simplify(coords: number[], first: number, last: number, sqTolerance: number) {
    const stack = [first, last];

    while (stack.length) {
        last = stack.pop();
        first = stack.pop();
        simplifySegment(coords, first, last, sqTolerance, stack);
    }
}

function simplifySegment(coords: number[], first: number, last: number, sqTolerance: number, stack: number[]) {
    let maxSqDist = sqTolerance;
    const mid = first + ((last - first) >> 1);
    let minPosToMid = last - first;
    let index;

    const ax = coords[first];
    const ay = coords[first + 1];
    const bx = coords[last];
    const by = coords[last + 1];

    for (let i = first + 3; i < last; i += 3) {
        const d = getSqSegDist(coords[i], coords[i + 1], ax, ay, bx, by);

        if (d > maxSqDist) {
            index = i;
            maxSqDist = d;
            continue;
        }

        if (d === maxSqDist) {
            // a workaround to ensure we choose a pivot close to the middle of the list,
            // reducing recursion depth, for certain degenerate inputs
            // https://github.com/mapbox/geojson-vt/issues/104
            const posToMid = Math.abs(i - mid);
            if (posToMid < minPosToMid) {
                index = i;
                minPosToMid = posToMid;
            }
        }
    }

    if (maxSqDist > sqTolerance) {
        coords[index + 2] = maxSqDist;
        if (index - first > 3) stack.push(first, index);
        if (last - index > 3) stack.push(index, last);
    }
}

/**
 * Claculates the square distance from a point to a segment
 * @param px - x coordinate of the point
 * @param py - y coordinate of the point
 * @param x - x coordinate of the first segment endpoint
 * @param y - y coordinate of the first segment endpoint
 * @param bx - x coordinate of the second segment endpoint
 * @param by - y coordinate of the second segment endpoint
 * @returns square distance from a point to a segment
 */
function getSqSegDist(px: number, py: number, x: number, y: number, bx: number, by: number): number {
    let dx = bx - x;
    let dy = by - y;

    if (dx !== 0 || dy !== 0) {
        const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);

        if (t > 1) {
            x = bx;
            y = by;

        } else if (t > 0) {
            x += dx * t;
            y += dy * t;
        }
    }

    dx = px - x;
    dy = py - y;

    return dx * dx + dy * dy;
}
