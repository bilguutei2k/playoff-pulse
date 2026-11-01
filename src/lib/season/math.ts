// Small numeric helpers for the season engine. Pure and dependency free.

/** Standard normal CDF (Hart / West double-precision approximation). */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) {
    if (z === Infinity) return 1;
    if (z === -Infinity) return 0;
    return 0.5;
  }
  const x = Math.abs(z);
  let cumulative: number;
  if (x > 37) {
    cumulative = 0;
  } else {
    const exponential = Math.exp((-x * x) / 2);
    if (x < 7.07106781186547) {
      let build = 3.52624965998911e-2 * x + 0.700383064443688;
      build = build * x + 6.37396220353165;
      build = build * x + 33.912866078383;
      build = build * x + 112.079291497871;
      build = build * x + 221.213596169931;
      build = build * x + 220.206867912376;
      cumulative = exponential * build;
      build = 8.83883476483184e-2 * x + 1.75566716318264;
      build = build * x + 16.064177579207;
      build = build * x + 86.7807322029461;
      build = build * x + 296.564248779674;
      build = build * x + 637.333633378831;
      build = build * x + 793.826512519948;
      build = build * x + 440.413735824752;
      cumulative /= build;
    } else {
      let build = x + 0.65;
      build = x + 4 / build;
      build = x + 3 / build;
      build = x + 2 / build;
      build = x + 1 / build;
      cumulative = exponential / build / 2.506628274631;
    }
  }
  return z > 0 ? 1 - cumulative : cumulative;
}

export function clampProbability(value: number, floor = 1e-6): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1 - floor, Math.max(floor, value));
}

/** FNV-1a over a string, hex. For input fingerprints, not security. */
export function fingerprint(value: string): string {
  let high = 0x811c9dc5;
  let low = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    high = Math.imul(high ^ code, 16777619);
    low = Math.imul(low ^ (code * 31), 2166136261);
  }
  return `${(high >>> 0).toString(16).padStart(8, "0")}${(low >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

/**
 * Lower-triangular Cholesky factor of a symmetric matrix (row-major, n x n).
 * Adds a small diagonal jitter for numerical safety, and throws if the matrix
 * is not positive definite, because a forecast from it could not be trusted.
 */
export function cholesky(matrix: ArrayLike<number>, n: number): Float64Array {
  const lower = new Float64Array(n * n);
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = matrix[row * n + column];
      if (row === column) sum += 1e-9;
      for (let k = 0; k < column; k += 1) {
        sum -= lower[row * n + k] * lower[column * n + k];
      }
      if (row === column) {
        if (sum <= 0) {
          throw new Error(`Covariance is not positive definite at index ${row}.`);
        }
        lower[row * n + column] = Math.sqrt(sum);
      } else {
        lower[row * n + column] = sum / lower[column * n + column];
      }
    }
  }
  return lower;
}

export function quantileFromHistogram(
  histogram: ArrayLike<number>,
  total: number,
  quantile: number,
): number {
  const target = quantile * total;
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= target) return index;
  }
  return histogram.length - 1;
}
