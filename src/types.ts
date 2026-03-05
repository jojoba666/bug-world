export enum BugState {
  WANDER = "WANDER",
  CHASE = "CHASE",
  RETURN = "RETURN",
  SLEEP = "SLEEP",
  REST = "REST",
  DEAD = "DEAD",
}

export interface Food {
  id: string;
  x: number;
  y: number;
  mass: number;
  born: number;
  ttl: number;
}

export interface Bug {
  id: string;
  x: number;
  y: number;
  w: number;
  
  // Internal drives (0..1)
  hunger: number;
  repro: number;
  fatigue: number;
  age: number;

  // State machine
  state: BugState;
  targetFoodId: string | null;
  chaseLockUntil: number;

  wanderTarget: { x: number; y: number } | null;
  wanderTargetSetT: number;

  sleepUntil: number;
  sleepStartedAt: number;
  breedCdUntil: number;
}

export interface SimStats {
  t: number;
  alive: number;
  avgWeight: number;
  births: number;
  deaths: number;
  avgHunger: number;
  avgRepro: number;
  autoFeed: boolean;
}
