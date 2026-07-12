/*! Open Historia - smooth ray-sphere globe lighting (c) 2026 Nicholas Krol, MIT. */

export const renderGlobeLightingPixels = ({
  matrix,
  cameraPosition,
  sunDirection,
  pixelWidth,
  pixelHeight,
  opacity,
  outputPixels,
}) => {
  const sphereRadius = 1;
  const smoothstep = (minimum, maximum, value) => {
    const progress = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
    return progress * progress * (3 - 2 * progress);
  };
  const invertMatrix = (source) => {
    const result = new Float64Array(16);
    const a00 = source[0]; const a01 = source[1]; const a02 = source[2]; const a03 = source[3];
    const a10 = source[4]; const a11 = source[5]; const a12 = source[6]; const a13 = source[7];
    const a20 = source[8]; const a21 = source[9]; const a22 = source[10]; const a23 = source[11];
    const a30 = source[12]; const a31 = source[13]; const a32 = source[14]; const a33 = source[15];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
    const inverseDeterminant = 1 / determinant;
    result[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant;
    result[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inverseDeterminant;
    result[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant;
    result[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inverseDeterminant;
    result[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inverseDeterminant;
    result[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant;
    result[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inverseDeterminant;
    result[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant;
    result[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant;
    result[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inverseDeterminant;
    result[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant;
    result[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inverseDeterminant;
    result[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inverseDeterminant;
    result[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inverseDeterminant;
    result[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inverseDeterminant;
    result[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inverseDeterminant;
    return result;
  };
  const outputLength = pixelWidth * pixelHeight * 4;
  const pixels = outputPixels?.length === outputLength
    ? outputPixels
    : new Uint8ClampedArray(outputLength);
  pixels.fill(0);
  const inverse = invertMatrix(matrix);
  if (!inverse) return pixels;
  const cameraX = cameraPosition[0];
  const cameraY = cameraPosition[1];
  const cameraZ = cameraPosition[2];
  const cameraTerm = cameraX * cameraX + cameraY * cameraY + cameraZ * cameraZ - sphereRadius * sphereRadius;
  const clipStep = 2 / pixelWidth;
  const clipStart = clipStep * 0.5 - 1;
  const stepX = (inverse[0] - cameraX * inverse[3]) * clipStep;
  const stepY = (inverse[1] - cameraY * inverse[3]) * clipStep;
  const stepZ = (inverse[2] - cameraZ * inverse[3]) * clipStep;
  const cameraDotStep = cameraX * stepX + cameraY * stepY + cameraZ * stepZ;
  const stepLengthSquared = stepX * stepX + stepY * stepY + stepZ * stepZ;
  const quadraticA = cameraDotStep * cameraDotStep - stepLengthSquared * cameraTerm;

  for (let y = 0; y < pixelHeight; y += 1) {
    const clipY = 1 - ((y + 0.5) / pixelHeight) * 2;
    const pointW = inverse[3] * clipStart + inverse[7] * clipY + inverse[15];
    const baseX = inverse[0] * clipStart + inverse[4] * clipY + inverse[12] - cameraX * pointW;
    const baseY = inverse[1] * clipStart + inverse[5] * clipY + inverse[13] - cameraY * pointW;
    const baseZ = inverse[2] * clipStart + inverse[6] * clipY + inverse[14] - cameraZ * pointW;
    const cameraDotBase = cameraX * baseX + cameraY * baseY + cameraZ * baseZ;
    const baseDotStep = baseX * stepX + baseY * stepY + baseZ * stepZ;
    const baseLengthSquared = baseX * baseX + baseY * baseY + baseZ * baseZ;
    const quadraticB = 2 * (cameraDotBase * cameraDotStep - baseDotStep * cameraTerm);
    const quadraticC = cameraDotBase * cameraDotBase - baseLengthSquared * cameraTerm;
    const rootDiscriminant = quadraticB * quadraticB - 4 * quadraticA * quadraticC;
    if (rootDiscriminant <= 0 || Math.abs(quadraticA) < 1e-20) continue;
    const rootScale = Math.sqrt(rootDiscriminant);
    const firstRoot = (-quadraticB - rootScale) / (2 * quadraticA);
    const secondRoot = (-quadraticB + rootScale) / (2 * quadraticA);
    const startX = Math.max(0, Math.ceil(Math.min(firstRoot, secondRoot)));
    const endX = Math.min(pixelWidth - 1, Math.floor(Math.max(firstRoot, secondRoot)));
    if (startX > endX) continue;
    let directionX = baseX + stepX * startX;
    let directionY = baseY + stepY * startX;
    let directionZ = baseZ + stepZ * startX;
    let offset = (y * pixelWidth + startX) * 4;

    for (let x = startX; x <= endX; x += 1, offset += 4) {
      const currentDirectionX = directionX;
      const currentDirectionY = directionY;
      const currentDirectionZ = directionZ;
      directionX += stepX;
      directionY += stepY;
      directionZ += stepZ;
      const directionLengthSquared = currentDirectionX * currentDirectionX
        + currentDirectionY * currentDirectionY
        + currentDirectionZ * currentDirectionZ;
      const cameraDotDirection = cameraX * currentDirectionX
        + cameraY * currentDirectionY
        + cameraZ * currentDirectionZ;
      const discriminant = cameraDotDirection * cameraDotDirection - directionLengthSquared * cameraTerm;
      if (discriminant <= 0 || directionLengthSquared <= 0) continue;
      const distance = (-cameraDotDirection - Math.sqrt(discriminant)) / directionLengthSquared;
      if (distance <= 0) continue;
      const normalX = (cameraX + currentDirectionX * distance) / sphereRadius;
      const normalY = (cameraY + currentDirectionY * distance) / sphereRadius;
      const normalZ = (cameraZ + currentDirectionZ * distance) / sphereRadius;
      const sunDot = normalX * sunDirection[0] + normalY * sunDirection[1] + normalZ * sunDirection[2];
      const night = 1 - smoothstep(-0.1, 0.08, sunDot);
      const dusk = smoothstep(-0.18, -0.02, sunDot) * (1 - smoothstep(0.03, 0.2, sunDot));
      const daylight = smoothstep(0.05, 0.9, sunDot);
      const nightAlpha = night * 0.72;
      const duskAlpha = dusk * 0.12;
      const dayAlpha = daylight * 0.045;
      const weight = nightAlpha + duskAlpha + dayAlpha;
      if (weight < 0.002) continue;
      const edgeAlpha = smoothstep(0, 0.0025, discriminant / directionLengthSquared);
      const alpha = Math.min(0.76, weight) * opacity * edgeAlpha;
      pixels[offset] = Math.round((3 * nightAlpha + 240 * duskAlpha + 255 * dayAlpha) / weight);
      pixels[offset + 1] = Math.round((7 * nightAlpha + 83 * duskAlpha + 178 * dayAlpha) / weight);
      pixels[offset + 2] = Math.round((24 * nightAlpha + 35 * duskAlpha + 95 * dayAlpha) / weight);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
};

export const buildGlobeLightingWorkerSource = () => `
  const renderGlobeLightingPixels = ${renderGlobeLightingPixels.toString()};
  self.onmessage = ({ data }) => {
    const pixels = renderGlobeLightingPixels(data);
    self.postMessage({
      pixels: pixels.buffer,
      width: data.pixelWidth,
      height: data.pixelHeight,
      requestId: data.requestId,
    }, [pixels.buffer]);
  };
`;
