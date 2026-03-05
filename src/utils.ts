import { Bug, Food, BugState } from './types';
import * as C from './constants';

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function distSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

export function getSpeed(weight: number): number {
  const v = C.V0 * Math.pow(C.W_REF / Math.max(weight, 1e-6), C.K_SPEED);
  return clamp(v, C.V_MIN, C.V_MAX);
}

export function samplePoisson(lam: number): number {
  const L = Math.exp(-lam);
  let k = 0;
  let p = 1.0;
  while (p > L) {
    k++;
    p *= Math.random();
  }
  return k - 1;
}

export function softmaxChoice<T>(items: { key: T; utility: number }[], temp: number, eps: number): T {
  if (items.length === 0) throw new Error("Empty items for softmax");
  if (Math.random() < eps) {
    return items[Math.floor(Math.random() * items.length)].key;
  }
  
  const utils = items.map(i => i.utility);
  const m = Math.max(...utils);
  const exps = utils.map(u => Math.exp((u - m) / Math.max(1e-6, temp)));
  const sum = exps.reduce((a, b) => a + b, 0);
  
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= exps[i];
    if (r <= 0) return items[i].key;
  }
  return items[items.length - 1].key;
}

export function hungerRate(weight: number): number {
  const factor = clamp((80.0 - weight) / 60.0, 0.0, 1.0);
  return 0.020 + 0.080 * factor;
}

export function reproRate(weight: number, hunger: number, age: number): number {
  const mature = age >= 30.0 ? 1.0 : 0.0;
  const weightGate = clamp((weight - 70.0) / 60.0, 0.0, 1.0);
  let rate = mature * (0.003 + 0.020 * weightGate * (1.0 - hunger));
  
  // Age-based surge: approaching 5 mins (300s)
  if (age > 240) {
    const ageFactor = clamp((age - 240) / 60, 0, 1);
    rate += 0.1 * ageFactor; // Rapid increase in reproduction desire
  }
  
  return rate;
}

export function hungerDrop(mass: number): number {
  return mass >= 20.0 ? C.HUNGER_DROP_20 : C.HUNGER_DROP_10;
}

export function estimateEta(b: Bug, tx: number, ty: number): number {
  const d = Math.sqrt(distSq(b.x, b.y, tx, ty));
  return d / Math.max(1e-6, getSpeed(b.w));
}

export function gridKey(x: number, y: number): string {
  return `${Math.floor(x / C.CELL)},${Math.floor(y / C.CELL)}`;
}
