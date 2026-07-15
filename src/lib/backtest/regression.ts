export type RidgeModel = {
  featureNames: string[];
  means: number[];
  scales: number[];
  coefficients: number[];
  intercept: number;
  lambda: number;
};

export type LogisticModel = RidgeModel;

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < augmented.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < augmented.length; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 1e-12) throw new Error("Regression matrix is singular.");
    for (let index = column; index <= augmented.length; index += 1) {
      augmented[column][index] /= divisor;
    }
    for (let row = 0; row < augmented.length; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= augmented.length; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map((row) => row[augmented.length]);
}

export function fitRidgeModel(
  rows: number[][],
  outcomes: number[],
  featureNames: string[],
  lambda: number,
): RidgeModel {
  if (!rows.length || rows.length !== outcomes.length) throw new Error("Invalid regression data.");
  const width = featureNames.length;
  const means = Array.from({ length: width }, (_, column) =>
    rows.reduce((sum, row) => sum + row[column], 0) / rows.length,
  );
  const scales = Array.from({ length: width }, (_, column) => {
    const variance = rows.reduce((sum, row) => sum + (row[column] - means[column]) ** 2, 0) / rows.length;
    return Math.sqrt(variance) || 1;
  });
  const normalized = rows.map((row) => row.map((value, column) => (value - means[column]) / scales[column]));
  const design = normalized.map((row) => [1, ...row]);
  const size = width + 1;
  const gram = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) =>
      design.reduce((sum, row) => sum + row[i] * row[j], 0) + (i === j && i > 0 ? lambda : 0),
    ),
  );
  const rhs = Array.from({ length: size }, (_, i) =>
    design.reduce((sum, row, index) => sum + row[i] * outcomes[index], 0),
  );
  const [intercept, ...coefficients] = solveLinearSystem(gram, rhs);
  return { featureNames, means, scales, coefficients, intercept, lambda };
}

export function predictRidge(model: RidgeModel, features: number[]): number {
  return model.intercept + features.reduce(
    (sum, value, index) =>
      sum + model.coefficients[index] * ((value - model.means[index]) / model.scales[index]),
    0,
  );
}

export function logisticProbability(margin: number, scale: number): number {
  return 1 / (1 + Math.exp(-margin / Math.max(0.1, scale)));
}

export function tuneLogisticScale(margins: number[], outcomes: number[]): number {
  let bestScale = 6.5;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (let scale = 2; scale <= 16; scale += 0.1) {
    const loss = margins.reduce((sum, margin, index) => {
      const p = Math.min(1 - 1e-7, Math.max(1e-7, logisticProbability(margin, scale)));
      const y = outcomes[index];
      return sum - y * Math.log(p) - (1 - y) * Math.log(1 - p);
    }, 0) / margins.length;
    if (loss < bestLoss) {
      bestLoss = loss;
      bestScale = scale;
    }
  }
  return Number(bestScale.toFixed(1));
}

export function fitLogisticModel(
  rows: number[][],
  outcomes: number[],
  featureNames: string[],
  lambda: number,
): LogisticModel {
  if (!rows.length || rows.length !== outcomes.length) throw new Error("Invalid logistic data.");
  const width = featureNames.length;
  const means = Array.from({ length: width }, (_, column) => meanColumn(rows, column));
  const scales = Array.from({ length: width }, (_, column) => {
    const variance = rows.reduce((sum, row) => sum + (row[column] - means[column]) ** 2, 0) / rows.length;
    return Math.sqrt(variance) || 1;
  });
  const design = rows.map((row) => [1, ...row.map((value, index) => (value - means[index]) / scales[index])]);
  let beta = Array.from({ length: width + 1 }, () => 0);
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const hessian = Array.from({ length: width + 1 }, () => Array.from({ length: width + 1 }, () => 0));
    const gradient = Array.from({ length: width + 1 }, () => 0);
    design.forEach((row, rowIndex) => {
      const linear = row.reduce((sum, value, index) => sum + value * beta[index], 0);
      const probability = 1 / (1 + Math.exp(-linear));
      const weight = Math.max(1e-6, probability * (1 - probability));
      for (let i = 0; i < row.length; i += 1) {
        gradient[i] += row[i] * (outcomes[rowIndex] - probability);
        for (let j = 0; j < row.length; j += 1) hessian[i][j] += row[i] * row[j] * weight;
      }
    });
    for (let i = 1; i < beta.length; i += 1) {
      hessian[i][i] += lambda;
      gradient[i] -= lambda * beta[i];
    }
    const delta = solveLinearSystem(hessian, gradient);
    beta = beta.map((value, index) => value + delta[index]);
    if (delta.reduce((sum, value) => sum + Math.abs(value), 0) < 1e-8) break;
  }
  return { featureNames, means, scales, intercept: beta[0], coefficients: beta.slice(1), lambda };
}

function meanColumn(rows: number[][], column: number): number {
  return rows.reduce((sum, row) => sum + row[column], 0) / rows.length;
}

export function predictLogistic(model: LogisticModel, features: number[]): number {
  return 1 / (1 + Math.exp(-predictRidge(model, features)));
}
