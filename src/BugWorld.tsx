import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Bug, Food, BugState, SimStats } from './types';
import * as C from './constants';
import * as U from './utils';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { Play, Pause, RefreshCw, Activity, Download, Settings2, Brain, Send, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const BugWorld = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showDrives, setShowDrives] = useState(false);
  const [autoFeed, setAutoFeed] = useState(true);
  const [stats, setStats] = useState<SimStats[]>([]);
  const [currentStats, setCurrentStats] = useState({
    alive: 0,
    total: 0,
    foods: 0,
    isAbundant: true,
    seasonTimeLeft: 0
  });

  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);

  const handleAiConsult = async () => {
    if (!aiQuery.trim()) return;
    setIsAiThinking(true);
    setAiResponse('');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `Current Simulation State:
- Alive Bugs: ${currentStats.alive}
- Total Food Items: ${currentStats.foods}
- Simulation Time: ${stats.length > 0 ? stats[stats.length-1].t : 0}s
- Avg Hunger Drive: ${stats.length > 0 ? (stats[stats.length-1].avgHunger * 100).toFixed(1) : 0}%
- Avg Repro Drive: ${stats.length > 0 ? (stats[stats.length-1].avgRepro * 100).toFixed(1) : 0}%

User Inquiry: ${aiQuery}`,
        config: {
          systemInstruction: "You are an expert simulation strategist for 'Bug World'. Analyze the simulation state and provide strategic advice. Use concise, professional language. Focus on population stability and resource management.",
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
        }
      });
      setAiResponse(response.text || 'No response from AI.');
    } catch (error) {
      console.error('AI Error:', error);
      setAiResponse('Error consulting the AI Strategist.');
    } finally {
      setIsAiThinking(false);
    }
  };

  // Simulation State Refs (to avoid re-renders on every frame)
  const bugsRef = useRef<Bug[]>([]);
  const foodsRef = useRef<Food[]>([]);
  const lastTimeRef = useRef<number>(0);
  const statsAccRef = useRef<number>(0);
  const birthsThisSecRef = useRef<number>(0);
  const deathsThisSecRef = useRef<number>(0);
  const simStartRef = useRef<number>(Date.now());
  const lastClickRef = useRef<{ t: number; x: number; y: number }>({ t: 0, x: 0, y: 0 });

  // Bed Manager Logic
  const bedsRef = useRef<{ x: number; y: number }[]>([]);
  const occupiedBedsRef = useRef<Map<number, string>>(new Map()); // bedIndex -> bugId
  const bugToBedRef = useRef<Map<string, number>>(new Map()); // bugId -> bedIndex

  useEffect(() => {
    // Initialize Beds
    const beds: { x: number; y: number }[] = [];
    const spacing = 12;
    const x0 = C.DIV_X + 10, x1 = C.W - 10;
    const y0 = 10, y1 = C.H - 10;
    for (let y = y0; y <= y1; y += spacing) {
      for (let x = x0; x <= x1; x += spacing) {
        beds.push({ x, y });
      }
    }
    bedsRef.current = beds;

    // Initial Bugs
    bugsRef.current = [
      createBug(C.DIV_X + 100, C.H / 2 - 40, 50),
      createBug(C.DIV_X + 120, C.H / 2 + 40, 50),
    ];

    requestAnimationFrame(animate);
  }, []);

  const createBug = (x: number, y: number, w: number, hunger = 0, repro = 0, fatigue = 0): Bug => ({
    id: Math.random().toString(36).substr(2, 9),
    x, y, w,
    hunger, repro, fatigue,
    age: 0,
    state: BugState.WANDER,
    targetFoodId: null,
    chaseLockUntil: 0,
    wanderTarget: null,
    wanderTargetSetT: 0,
    sleepUntil: 0,
    sleepStartedAt: 0,
    breedCdUntil: 0,
  });

  const animate = (time: number) => {
    if (!lastTimeRef.current) lastTimeRef.current = time;
    const dt = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;

    if (!isPaused) {
      updateSimulation(dt);
    }

    draw();
    requestAnimationFrame(animate);
  };

  const isAtHome = (b: Bug, buffer = 0) => {
    const d2 = U.distSq(b.x, b.y, C.HOME_CENTER_X, C.HOME_CENTER_Y);
    return d2 <= (C.HOME_RADIUS + buffer) * (C.HOME_RADIUS + buffer);
  };

  const updateSimulation = (dt: number) => {
    const now = Date.now();
    const simT = (now - simStartRef.current) / 1000;

    // 1. Auto Feed
    const cycleT = simT % (C.SEASON_ABUNDANT_SEC + C.SEASON_SCARCE_SEC);
    const isAbundant = cycleT < C.SEASON_ABUNDANT_SEC;
    const seasonTimeLeft = isAbundant 
      ? C.SEASON_ABUNDANT_SEC - cycleT 
      : (C.SEASON_ABUNDANT_SEC + C.SEASON_SCARCE_SEC) - cycleT;

    if (autoFeed) {
      const seasonalMultiplier = isAbundant ? 1.0 : 0.1; // 10% in scarce period

      if (Math.random() < C.POISSON_LAMBDA * seasonalMultiplier * dt) {
        const k = Math.floor(Math.random() * (C.AUTO_FEED_MAX_PER_SEC + 1));
        for (let i = 0; i < k; i++) {
          // Spawn food ANYWHERE on the map
          const fx = Math.random() * (C.W - 20) + 10;
          const fy = Math.random() * (C.H - 20) + 10;
          addFood(fx, fy, Math.random() < C.AUTO_FOOD_P20 ? 20 : 10);
        }
      }
    }

    // 2. Clean Foods
    foodsRef.current = foodsRef.current.filter(f => (now - f.born) < f.ttl);

    // 3. Spatial Hash for Foods
    const grid = new Map<string, string[]>();
    foodsRef.current.forEach(f => {
      const key = U.gridKey(f.x, f.y);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(f.id);
    });

    // 4. Update Bugs
    const bugs = bugsRef.current;
    const newBugs: Bug[] = [];

    bugs.forEach((b, bi) => {
      if (b.state === BugState.DEAD) return;

      b.age += dt;
      b.hunger = U.clamp(b.hunger + dt * U.hungerRate(b.w), 0, 1);
      b.repro = U.clamp(b.repro + dt * U.reproRate(b.w, b.hunger, b.age), 0, 1);

      if (b.state === BugState.SLEEP) {
        b.fatigue = U.clamp(b.fatigue - dt * C.FATIGUE_RECOVER_SLEEP, 0, 1);
        b.w -= C.METABOLIC_SLEEP * dt;
        const slept = now - b.sleepStartedAt;
        if (now >= b.sleepUntil || (slept >= C.SLEEP_MIN && b.hunger >= 0.85)) {
          releaseBed(b.id);
          b.state = BugState.RETURN;
        }
      } else if (b.state === BugState.REST) {
        b.fatigue = U.clamp(b.fatigue - dt * C.FATIGUE_RECOVER_REST, 0, 1);
        b.w -= C.METABOLIC_STAND_REST * dt;
      } else {
        b.fatigue = U.clamp(b.fatigue + dt * C.FATIGUE_RATE_AWAKE, 0, 1);
        b.w -= C.METABOLIC_AWAKE * dt;
      }

      if (b.w < C.DEATH_WEIGHT) {
        b.state = BugState.DEAD;
        releaseBed(b.id);
        deathsThisSecRef.current++;
        addFood(Math.min(b.x, C.DIV_X - 5), U.clamp(b.y, 5, C.H - 5), 10);
        return;
      }

      // Decision Making
      if (b.state !== BugState.SLEEP) {
        const inHome = isAtHome(b);
        const inHomeWithHysteresis = isAtHome(b, C.HOME_HYSTERESIS);

        // Sensing
        const visibleFoods: string[] = [];
        const rCells = Math.ceil(C.SENSE_RADIUS / C.CELL);
        const cx = Math.floor(b.x / C.CELL);
        const cy = Math.floor(b.y / C.CELL);
        for (let gx = cx - rCells; gx <= cx + rCells; gx++) {
          for (let gy = cy - rCells; gy <= cy + rCells; gy++) {
            const key = `${gx},${gy}`;
            const cellFoods = grid.get(key);
            if (cellFoods) {
              cellFoods.forEach(fid => {
                const f = foodsRef.current.find(food => food.id === fid);
                if (f && U.distSq(b.x, b.y, f.x, f.y) <= C.SENSE_RADIUS * C.SENSE_RADIUS) {
                  visibleFoods.push(fid);
                }
              });
            }
          }
        }

        let bestFoodId: string | null = null;
        let bestFoodU = -Infinity;
        visibleFoods.forEach(fid => {
          const f = foodsRef.current.find(food => food.id === fid)!;
          const eta = U.estimateEta(b, f.x, f.y);
          const u = 1.6 * b.hunger + 0.4 * (f.mass / 20.0) - 0.9 * eta;
          if (u > bestFoodU) {
            bestFoodU = u;
            bestFoodId = fid;
          }
        });

        const items: { key: string; utility: number }[] = [];
        
        // State Locking: Prevent oscillation when moving between zones
        const isMovingToTarget = b.state === BugState.RETURN && b.wanderTarget;
        const targetIsHome = isMovingToTarget && U.distSq(b.wanderTarget!.x, b.wanderTarget!.y, C.HOME_CENTER_X, C.HOME_CENTER_Y) < C.HOME_RADIUS * C.HOME_RADIUS;
        const targetIsHunt = isMovingToTarget && !targetIsHome;
        
        // Only unlock if we see food or are truly starving AND see food
        const seesFood = bestFoodId !== null;
        const isStarving = b.hunger > 0.98;

        if (targetIsHome && !inHome && !seesFood) {
          // Locked: Moving towards home from hunt
          items.push({ key: "GO_HOME", utility: 100 });
        } else if (targetIsHunt && inHome && !seesFood) {
          // Locked: Moving towards hunt from home
          items.push({ key: "GO_HUNT", utility: 100 });
        } else {
          const isLegacy = b.age > 270; // Approaching 5 mins (300s)

          if (bestFoodId) items.push({ key: "CHASE", utility: bestFoodU });
          
          // All map is now Home Zone. No GO_HUNT logic.
          // GO_HOME now acts as a general "Wander/Stay in Home" drive.
          let uHome = 0.6 + 0.5 * b.repro + 0.4 * (isLegacy ? 0 : b.fatigue) - 0.2 * b.hunger;
          if (b.w > 170) uHome += (b.w - 170) * 0.1;
          if (isLegacy && b.repro > 0.9) uHome += 20; 
          items.push({ key: "GO_HOME", utility: uHome });

          if (inHome) {
            // Relaxed hunger check for breeding (was 0.8)
            if (b.hunger < 0.98) {
              if (!isLegacy) {
                items.push({ key: "SLEEP", utility: 1.3 * b.fatigue - 1.1 * b.hunger + 0.2 * (1.0 - b.repro) });
              }
              if (b.w > C.BREED_THRESHOLD && now >= b.breedCdUntil && bugs.length < C.MAX_BUGS) {
                // Legacy bugs get a massive boost to breeding utility
                items.push({ key: "BREED", utility: 5.0 + 2.2 * b.repro + (isLegacy ? 50 : 0) }); 
              }
            }
          }

          // Only wander if not hungry or already in hunt
          if (b.hunger < 0.6 || !inHome) {
            items.push({ key: "WANDER", utility: 0.10 + 0.15 * (1.0 - b.hunger) + 0.10 * (isLegacy ? 0 : (1.0 - b.fatigue)) });
          }
        }

        const action = U.softmaxChoice(items, C.SOFTMAX_TEMP, C.EPSILON_RANDOM);

        if (action === "BREED") {
          const childW = b.w * C.BREED_FACTOR_EACH;
          b.w = childW;
          b.repro = U.clamp(b.repro * 0.25, 0, 1);
          b.fatigue = U.clamp(b.fatigue + 0.20, 0, 1);
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * 20 + 10;
          const nx = U.clamp(b.x + Math.cos(angle) * dist, 1, C.W - 1);
          const ny = U.clamp(b.y + Math.sin(angle) * dist, 1, C.H - 1);
          newBugs.push(createBug(nx, ny, childW, b.hunger * 0.6, 0, b.fatigue * 0.5));
          b.breedCdUntil = now + C.BREED_COOLDOWN;
          birthsThisSecRef.current++;
          b.state = BugState.WANDER;
          b.targetFoodId = null;
          b.wanderTarget = null;
        } else if (action === "SLEEP" && inHome) {
          const bed = tryAssignBed(b.id);
          if (bed) {
            if (U.distSq(b.x, b.y, bed.x, bed.y) <= C.EAT_RADIUS * C.EAT_RADIUS) {
              b.state = BugState.SLEEP;
              b.sleepStartedAt = now;
              b.sleepUntil = now + C.SLEEP_MAX;
            } else {
              b.state = BugState.REST;
              moveTowards(b, bed.x, bed.y, dt);
            }
          } else {
            b.state = BugState.REST;
          }
        } else {
          if (b.state !== BugState.REST) releaseBed(b.id);
          
          if (action === "GO_HOME") {
            b.state = BugState.RETURN;
            b.targetFoodId = null;
            
            // Target locking: only re-target if null or hold time expired
            if (!b.wanderTarget || (now - b.wanderTargetSetT) > C.WANDER_TARGET_HOLD) {
              // Target deep inside home
              const angle = Math.random() * Math.PI * 2;
              const dist = Math.random() * (C.HOME_RADIUS * 0.6);
              b.wanderTarget = { 
                x: C.HOME_CENTER_X + Math.cos(angle) * dist, 
                y: C.HOME_CENTER_Y + Math.sin(angle) * dist 
              };
              b.wanderTargetSetT = now;
            }
          } else if (action === "GO_HUNT") {
            b.state = BugState.RETURN;
            b.targetFoodId = null;
            
            // Target locking: only re-target if null or hold time expired
            if (!b.wanderTarget || (now - b.wanderTargetSetT) > C.WANDER_TARGET_HOLD) {
              // Target outside home (though currently unused in unified zone)
              const angle = Math.random() * Math.PI * 2;
              const dist = C.HOME_RADIUS + 100 + Math.random() * 200;
              b.wanderTarget = { 
                x: U.clamp(C.HOME_CENTER_X + Math.cos(angle) * dist, 20, C.W - 20), 
                y: U.clamp(C.HOME_CENTER_Y + Math.sin(angle) * dist, 20, C.H - 20)
              };
              b.wanderTargetSetT = now;
            }
          } else if (action === "CHASE" && bestFoodId) {
            if (now >= b.chaseLockUntil || !b.targetFoodId) {
              b.targetFoodId = bestFoodId;
              b.chaseLockUntil = now + C.CHASE_LOCK;
            }
            b.state = BugState.CHASE;
          } else {
            b.state = BugState.WANDER;
            if (!b.wanderTarget || (now - b.wanderTargetSetT) > C.WANDER_TARGET_HOLD) {
              if (inHome) {
                // Wander inside home
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * (C.HOME_RADIUS - 20);
                b.wanderTarget = { x: C.HOME_CENTER_X + Math.cos(angle) * dist, y: C.HOME_CENTER_Y + Math.sin(angle) * dist };
              } else {
                // Wander outside
                let tx, ty;
                let attempts = 0;
                do {
                  tx = Math.random() * (C.W - 40) + 20;
                  ty = Math.random() * (C.H - 40) + 20;
                  attempts++;
                } while (attempts < 50 && U.distSq(tx, ty, C.HOME_CENTER_X, C.HOME_CENTER_Y) < C.HOME_RADIUS * C.HOME_RADIUS);
                b.wanderTarget = { x: tx, y: ty };
              }
              b.wanderTargetSetT = now;
            }
          }
        }
      }

      // Movement Execution
      if (b.state === BugState.CHASE && b.targetFoodId) {
        const f = foodsRef.current.find(food => food.id === b.targetFoodId);
        if (f) {
          moveTowards(b, f.x, f.y, dt);
        } else {
          b.targetFoodId = null;
          b.state = BugState.WANDER;
        }
      } else if (b.state === BugState.RETURN && b.wanderTarget) {
        moveTowards(b, b.wanderTarget.x, b.wanderTarget.y, dt);
        // Arrived at destination
        if (U.distSq(b.x, b.y, b.wanderTarget.x, b.wanderTarget.y) < 400) {
          // If we were going home, we are now home, so we can wander/sleep
          // If we were going hunt, we are now in hunt, so we can wander/chase
          b.state = BugState.WANDER;
          b.wanderTarget = null;
        }
      } else if (b.state === BugState.WANDER && b.wanderTarget) {
        moveTowards(b, b.wanderTarget.x, b.wanderTarget.y, dt);
        if (U.distSq(b.x, b.y, b.wanderTarget.x, b.wanderTarget.y) < 144) b.wanderTarget = null;
      }
    });

    // 4.5 Collision Resolution (Non-overlapping bugs)
    const bugGrid = new Map<string, number[]>();
    const BUG_GRID_CELL = 40;
    bugsRef.current.forEach((b, i) => {
      if (b.state === BugState.DEAD) return;
      const key = `${Math.floor(b.x / BUG_GRID_CELL)},${Math.floor(b.y / BUG_GRID_CELL)}`;
      if (!bugGrid.has(key)) bugGrid.set(key, []);
      bugGrid.get(key)!.push(i);
    });

    for (let i = 0; i < bugsRef.current.length; i++) {
      const b1 = bugsRef.current[i];
      if (b1.state === BugState.DEAD) continue;
      const r1 = Math.sqrt(b1.w) * 0.8;
      const gx = Math.floor(b1.x / BUG_GRID_CELL);
      const gy = Math.floor(b1.y / BUG_GRID_CELL);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${gx + dx},${gy + dy}`;
          const neighbors = bugGrid.get(key);
          if (!neighbors) continue;
          for (const j of neighbors) {
            if (i >= j) continue;
            const b2 = bugsRef.current[j];
            const r2 = Math.sqrt(b2.w) * 0.8;
            const minDist = r1 + r2;
            const dist_x = b2.x - b1.x;
            const dist_y = b2.y - b1.y;
            const d2 = dist_x * dist_x + dist_y * dist_y;
            if (d2 < minDist * minDist && d2 > 0) {
              const d = Math.sqrt(d2);
              const overlap = minDist - d;
              const nx = dist_x / d;
              const ny = dist_y / d;
              const push = overlap / 2;
              b1.x -= nx * push;
              b1.y -= ny * push;
              b2.x += nx * push;
              b2.y += ny * push;
              b1.x = U.clamp(b1.x, 1, C.W - 1);
              b1.y = U.clamp(b1.y, 1, C.H - 1);
              b2.x = U.clamp(b2.x, 1, C.W - 1);
              b2.y = U.clamp(b2.y, 1, C.H - 1);
            }
          }
        }
      }
    }

    bugsRef.current = [...bugs, ...newBugs];

    // 5. Eating Logic
    const contenders = new Map<string, { bi: number; w: number }[]>();
    bugsRef.current.forEach((b, bi) => {
      if (b.state !== BugState.CHASE || !b.targetFoodId) return;
      const f = foodsRef.current.find(food => food.id === b.targetFoodId);
      if (f && U.distSq(b.x, b.y, f.x, f.y) <= C.EAT_RADIUS * C.EAT_RADIUS) {
        if (!contenders.has(f.id)) contenders.set(f.id, []);
        contenders.get(f.id)!.push({ bi, w: b.w });
      }
    });

    const eatenIds = new Set<string>();
    contenders.forEach((list, fid) => {
      list.sort((a, b) => b.w - a.w);
      const winner = bugsRef.current[list[0].bi];
      const food = foodsRef.current.find(f => f.id === fid)!;
      winner.w += food.mass;
      winner.hunger = U.clamp(winner.hunger - U.hungerDrop(food.mass), 0, 1);
      eatenIds.add(fid);
      list.forEach(item => {
        bugsRef.current[item.bi].targetFoodId = null;
        if (bugsRef.current[item.bi].state === BugState.CHASE) bugsRef.current[item.bi].state = BugState.WANDER;
      });
    });
    foodsRef.current = foodsRef.current.filter(f => !eatenIds.has(f.id));

    // 6. Stats Update
    statsAccRef.current += dt;
    if (statsAccRef.current >= 1.0) {
      statsAccRef.current -= 1.0;
      const aliveBugs = bugsRef.current.filter(b => b.state !== BugState.DEAD);
      const alive = aliveBugs.length;
      const avgW = alive > 0 ? aliveBugs.reduce((s, b) => s + b.w, 0) / alive : 0;
      const avgH = alive > 0 ? aliveBugs.reduce((s, b) => s + b.hunger, 0) / alive : 0;
      const avgR = alive > 0 ? aliveBugs.reduce((s, b) => s + b.repro, 0) / alive : 0;

      const newStat: SimStats = {
        t: Math.floor(simT),
        alive,
        avgWeight: avgW,
        births: birthsThisSecRef.current,
        deaths: deathsThisSecRef.current,
        avgHunger: avgH,
        avgRepro: avgR,
        autoFeed,
      };

      setStats(prev => [...prev.slice(-119), newStat]);
      setCurrentStats({
        alive,
        total: bugsRef.current.length,
        foods: foodsRef.current.length,
        isAbundant,
        seasonTimeLeft
      });
      birthsThisSecRef.current = 0;
      deathsThisSecRef.current = 0;
    }
  };

  const moveTowards = (b: Bug, tx: number, ty: number, dt: number) => {
    const dx = tx - b.x;
    const dy = ty - b.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) return;
    const step = U.getSpeed(b.w) * dt;
    if (step >= d) {
      b.x = tx;
      b.y = ty;
    } else {
      b.x += (dx / d) * step;
      b.y += (dy / d) * step;
    }
  };

  const tryAssignBed = (bugId: string) => {
    if (bugToBedRef.current.has(bugId)) {
      return bedsRef.current[bugToBedRef.current.get(bugId)!];
    }
    for (let i = 0; i < bedsRef.current.length; i++) {
      if (!occupiedBedsRef.current.has(i)) {
        occupiedBedsRef.current.set(i, bugId);
        bugToBedRef.current.set(bugId, i);
        return bedsRef.current[i];
      }
    }
    return null;
  };

  const releaseBed = (bugId: string) => {
    const bedIdx = bugToBedRef.current.get(bugId);
    if (bedIdx !== undefined) {
      occupiedBedsRef.current.delete(bedIdx);
      bugToBedRef.current.delete(bugId);
    }
  };

  const addFood = (x: number, y: number, mass: number) => {
    foodsRef.current.push({
      id: Math.random().toString(36).substr(2, 9),
      x, y, mass,
      born: Date.now(),
      ttl: C.FOOD_TTL,
    });
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) * (C.W / rect.width);
    const y = (e.clientY - rect.top) * (C.H / rect.height);
    
    // Can only drop food in Home Zone (inside circle)
    if (U.distSq(x, y, C.HOME_CENTER_X, C.HOME_CENTER_Y) <= C.HOME_RADIUS * C.HOME_RADIUS) {
      const now = Date.now();
      const isDouble = (now - lastClickRef.current.t) <= C.DOUBLE_CLICK_MS && 
                       (Math.abs(x - lastClickRef.current.x) + Math.abs(y - lastClickRef.current.y) < 10);
      const mass = isDouble ? 20 : 10;
      addFood(x, y, mass);
      lastClickRef.current = { t: now, x, y };
    }
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, C.W, C.H);

    // Unified Map Background
    ctx.fillStyle = '#1a1a1d'; 
    ctx.fillRect(0, 0, C.W, C.H);

    // Foods
    foodsRef.current.forEach(f => {
      ctx.fillStyle = f.mass >= 20 ? '#ffc850' : '#e6a03c';
      ctx.beginPath();
      ctx.arc(f.x, f.y, C.FOOD_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });

    // Bugs
    bugsRef.current.forEach(b => {
      if (b.state === BugState.DEAD) return;
      
      let color = '#ffffff';
      if (b.state === BugState.SLEEP) color = '#78aaff';
      else if (b.state === BugState.CHASE) color = '#78ff78';
      else if (b.state === BugState.RETURN) color = '#ff7878';
      else if (b.state === BugState.REST) color = '#c8c8ff';

      const radius = Math.sqrt(b.w) * 0.8;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (showDrives) {
        const bx = b.x;
        const by = b.y - radius - 5;
        const wbar = 22;
        
        // Hunger (orange)
        ctx.fillStyle = '#3c3c3c';
        ctx.fillRect(bx - wbar/2, by, wbar, 3);
        ctx.fillStyle = '#ff8c3c';
        ctx.fillRect(bx - wbar/2, by, wbar * b.hunger, 3);
        
        // Repro (purple)
        ctx.fillStyle = '#3c3c3c';
        ctx.fillRect(bx - wbar/2, by + 4, wbar, 3);
        ctx.fillStyle = '#c878ff';
        ctx.fillRect(bx - wbar/2, by + 4, wbar * b.repro, 3);
        
        // Fatigue (cyan)
        ctx.fillStyle = '#3c3c3c';
        ctx.fillRect(bx - wbar/2, by + 8, wbar, 3);
        ctx.fillStyle = '#78dcff';
        ctx.fillRect(bx - wbar/2, by + 8, wbar * b.fatigue, 3);
      }
    });
  };

  const exportCSV = () => {
    const headers = ["t_sec", "alive", "avg_weight", "births", "deaths", "avg_hunger", "avg_repro", "auto_feed"];
    const rows = stats.map(s => [
      s.t, s.alive, s.avgWeight.toFixed(3), s.births, s.deaths, s.avgHunger.toFixed(3), s.avgRepro.toFixed(3), s.autoFeed ? 1 : 0
    ]);
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "bug_world_stats.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col h-screen bg-[#141416] text-[#e6e6e6] font-sans selection:bg-emerald-500/30">
      {/* Header / HUD */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#1a1a1d]">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-lg font-semibold tracking-tight">Bug World</h1>
          </div>
          <div className="flex gap-4 text-xs font-mono text-white/40">
            <span className="flex items-center gap-1.5">
              <span className="text-white/60">ALIVE:</span> {currentStats.alive}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-white/60">TOTAL:</span> {currentStats.total}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-white/60">FOODS:</span> {currentStats.foods}
            </span>
            <div className="w-px h-3 bg-white/10 mx-1" />
            <span className="flex items-center gap-1.5">
              <span className={currentStats.isAbundant ? "text-emerald-400" : "text-amber-400"}>
                {currentStats.isAbundant ? "ABUNDANCE" : "SCARCITY"}:
              </span> 
              <span className="text-white/60">
                {Math.floor(currentStats.seasonTimeLeft / 60)}:{(currentStats.seasonTimeLeft % 60).toString().padStart(2, '0')}
              </span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsPaused(!isPaused)}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors text-white/60 hover:text-white"
            title={isPaused ? "Play" : "Pause"}
          >
            {isPaused ? <Play size={20} /> : <Pause size={20} />}
          </button>
          <button 
            onClick={() => window.location.reload()}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors text-white/60 hover:text-white"
            title="Reset"
          >
            <RefreshCw size={20} />
          </button>
          <div className="w-px h-4 bg-white/10 mx-2" />
          <button 
            onClick={() => setAutoFeed(!autoFeed)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              autoFeed ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-white/5 text-white/40 border border-transparent'
            }`}
          >
            <Activity size={14} />
            Auto Feed
          </button>
          <button 
            onClick={() => setShowDrives(!showDrives)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              showDrives ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'bg-white/5 text-white/40 border border-transparent'
            }`}
          >
            <Settings2 size={14} />
            Drives
          </button>
          <button 
            onClick={exportCSV}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium transition-all text-white/60 hover:text-white"
          >
            <Download size={14} />
            Export
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Simulation Area */}
        <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
          <div className="relative shadow-2xl shadow-black/50">
            <canvas
              ref={canvasRef}
              width={C.W}
              height={C.H}
              onClick={handleCanvasClick}
              className="max-h-[85vh] max-w-full aspect-square cursor-crosshair border border-white/5"
            />
          </div>
        </div>

        {/* Stats Sidebar */}
        <aside className="w-96 border-l border-white/5 bg-[#1a1a1d] flex flex-col">
          <div className="p-6 border-b border-white/5">
            <h2 className="text-sm font-semibold text-white/80 mb-1">Population Dynamics</h2>
            <p className="text-xs text-white/40">Real-time tracking of bug world metrics</p>
          </div>
          
          <div className="flex-1 p-6 space-y-8 overflow-y-auto">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                  <XAxis dataKey="t" hide />
                  <YAxis hide domain={[0, 'auto']} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1a1a1d', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
                    itemStyle={{ padding: '2px 0' }}
                  />
                  <Line type="monotone" dataKey="alive" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} name="Population" />
                  <Line type="monotone" dataKey="avgWeight" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} name="Avg Weight" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="text-[10px] font-mono text-white/40 uppercase mb-1">Birth Rate</div>
                <div className="text-xl font-semibold text-emerald-400">
                  {stats.length > 0 ? stats[stats.length - 1].births : 0}
                  <span className="text-[10px] text-white/20 ml-1">/s</span>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="text-[10px] font-mono text-white/40 uppercase mb-1">Death Rate</div>
                <div className="text-xl font-semibold text-rose-400">
                  {stats.length > 0 ? stats[stats.length - 1].deaths : 0}
                  <span className="text-[10px] text-white/20 ml-1">/s</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/40">Avg Hunger Drive</span>
                <span className="text-white/80">{(stats.length > 0 ? stats[stats.length - 1].avgHunger * 100 : 0).toFixed(1)}%</span>
              </div>
              <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-orange-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${(stats.length > 0 ? stats[stats.length - 1].avgHunger * 100 : 0)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-white/40">Avg Repro Drive</span>
                <span className="text-white/80">{(stats.length > 0 ? stats[stats.length - 1].avgRepro * 100 : 0).toFixed(1)}%</span>
              </div>
              <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-purple-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${(stats.length > 0 ? stats[stats.length - 1].avgRepro * 100 : 0)}%` }}
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
              <h3 className="text-xs font-semibold text-indigo-400 mb-3 flex items-center gap-2">
                <Brain size={14} />
                AI Strategist (Thinking Mode)
              </h3>
              <div className="space-y-3">
                <div className="relative">
                  <textarea
                    value={aiQuery}
                    onChange={(e) => setAiQuery(e.target.value)}
                    placeholder="Ask for strategic advice..."
                    className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-[11px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 resize-none h-16"
                  />
                  <button
                    onClick={handleAiConsult}
                    disabled={isAiThinking || !aiQuery.trim()}
                    className="absolute bottom-2 right-2 p-1.5 rounded-md bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-600 transition-colors"
                  >
                    {isAiThinking ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  </button>
                </div>
                
                <AnimatePresence>
                  {aiResponse && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-2.5 rounded-lg bg-white/5 border border-white/5 text-[11px] text-white/60 leading-relaxed max-h-40 overflow-y-auto custom-scrollbar"
                    >
                      {aiResponse}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
              <h3 className="text-xs font-semibold text-indigo-400 mb-2 flex items-center gap-2">
                <Activity size={12} />
                Simulation Guide
              </h3>
              <ul className="text-[11px] text-white/40 space-y-2 leading-relaxed">
                <li>• <span className="text-white/60">Click</span> anywhere to drop 10g food.</li>
                <li>• <span className="text-white/60">Double Click</span> for 20g food.</li>
                <li>• <span className="text-emerald-400">Unified World</span>: Bugs can eat, sleep, and breed anywhere.</li>
                <li>• <span className="text-amber-400">Legacy Mode</span>: At 4.5+ mins, bugs prioritize repro over sleep.</li>
                <li>• Food generates <span className="text-white/60">randomly</span> across the map.</li>
                <li>• Reproduction requires <span className="text-white/60">160g</span> weight.</li>
                <li>• Larger bugs move <span className="text-white/60">slower</span> but are easier to see.</li>
              </ul>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default BugWorld;
