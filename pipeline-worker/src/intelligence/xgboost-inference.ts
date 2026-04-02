/**
 * XGBoost inference engine — pure TypeScript, no dependencies.
 *
 * Loads the trained BTC model (scripts/btc_model.json) and runs
 * tree-traversal inference to produce a probability of "Up".
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Types ───

interface Tree {
  left_children: number[];
  right_children: number[];
  split_indices: number[];
  split_conditions: number[];
  base_weights: number[];
  default_left: number[];
}

interface XGBoostModel {
  trees: Tree[];
  baseScore: number;
  numFeatures: number;
}

// ─── Loader ───

let cachedModel: XGBoostModel | null = null;

export function loadModel(): XGBoostModel {
  if (cachedModel) return cachedModel;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const modelPath = resolve(__dirname, '../../models/btc_model.json');
  const raw = JSON.parse(readFileSync(modelPath, 'utf-8'));

  const learner = raw.learner;
  const trees: Tree[] = learner.gradient_booster.model.trees;
  const baseScoreStr: string = learner.learner_model_param.base_score;
  // Format is "[4.8715657E-1]" — strip brackets
  const baseScore = parseFloat(baseScoreStr.replace(/[[\]]/g, ''));

  cachedModel = {
    trees,
    baseScore,
    numFeatures: parseInt(learner.learner_model_param.num_feature, 10),
  };

  return cachedModel;
}

// ─── Inference ───

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function predictTree(tree: Tree, features: number[]): number {
  let node = 0;
  while (tree.left_children[node] !== -1) {
    const featureIdx = tree.split_indices[node];
    const threshold = tree.split_conditions[node];
    const value = features[featureIdx] ?? 0;

    // XGBoost default: go left if value < threshold, right otherwise
    // (default_left handles missing values — we use 0 for missing)
    if (value < threshold) {
      node = tree.left_children[node];
    } else {
      node = tree.right_children[node];
    }
  }
  return tree.base_weights[node];
}

/**
 * Run XGBoost inference on a feature vector.
 * Returns probability of "Up" (0–1).
 */
export function predict(features: number[]): number {
  const model = loadModel();
  let sum = model.baseScore;
  for (const tree of model.trees) {
    sum += predictTree(tree, features);
  }
  return sigmoid(sum);
}

/**
 * Get the feature names in order (for logging/display).
 */
export function getFeatureNames(): string[] {
  const model = loadModel();
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const configPath = resolve(__dirname, '../../models/btc_model_config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  return config.features as string[];
}

export function getModelInfo(): {
  numTrees: number;
  numFeatures: number;
  holdoutAccuracy: number;
  topFeatures: { name: string; importance: number }[];
} {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const configPath = resolve(__dirname, '../../models/btc_model_config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  loadModel(); // ensure model is loaded
  return {
    numTrees: cachedModel!.trees.length,
    numFeatures: cachedModel!.numFeatures,
    holdoutAccuracy: config.holdout_accuracy,
    topFeatures: config.top_features,
  };
}
