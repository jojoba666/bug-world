/**
 * Constants for the Bug World simulation
 */

export const W = 1000;
export const H = 1000;
export const DIV_X = W / 2; // Keep for legacy if needed, but we use center now

// Home Zone (Circle in center)
export const HOME_CENTER_X = 500;
export const HOME_CENTER_Y = 500;
export const HOME_RADIUS = 800; // Covers entire 1000x1000 map
export const HOME_HYSTERESIS = 20; // Extra distance needed to leave home

// Food
export const FOOD_TTL = 30000; // ms
export const FOOD_RADIUS = 4;

// Bug
export const BUG_RADIUS = 3;
export const SENSE_RADIUS = 2000;
export const EAT_RADIUS = 5;

// Metabolism (weight loss g/s)
export const METABOLIC_AWAKE = 0.4;
export const METABOLIC_SLEEP = 0.08;
export const METABOLIC_STAND_REST = 0.15;
export const DEATH_WEIGHT = 20.0;

// Sleep
export const SLEEP_MAX = 600000; // 10 min in ms
export const SLEEP_MIN = 5000;    // 5s in ms

// Reproduction
export const BREED_THRESHOLD = 160.0;
export const BREED_FACTOR_EACH = 0.45;
export const BREED_COOLDOWN = 3000; // ms
export const MAX_BUGS = 600;

// Speed vs weight
export const V0 = 100.0;
export const W_REF = 50.0;
export const K_SPEED = 0.736;
export const V_MIN = 24.0;
export const V_MAX = 160.0;

// Wander
export const WANDER_TARGET_HOLD = 1500; // ms

// Spatial hash
export const CELL = 100;

// Double click
export const DOUBLE_CLICK_MS = 250;

// Auto feed
export const POISSON_LAMBDA = 3.5;
export const AUTO_FEED_MAX_PER_SEC = 6;
export const AUTO_FOOD_P20 = 0.50;

// Seasons (in seconds)
export const SEASON_ABUNDANT_SEC = 600; // 10 min
export const SEASON_SCARCE_SEC = 300;   // 5 min

// Drive model
export const HUNGER_DROP_10 = 0.45;
export const HUNGER_DROP_20 = 0.80;
export const FATIGUE_RATE_AWAKE = 0.010;
export const FATIGUE_RECOVER_SLEEP = 0.060;
export const FATIGUE_RECOVER_REST = 0.030;

// Stochastic decision
export const SOFTMAX_TEMP = 0.45;
export const EPSILON_RANDOM = 0.06;

// Food choice stability
export const CHASE_LOCK = 1000; // ms
