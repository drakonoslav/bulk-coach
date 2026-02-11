import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const SEED_DAYS = 60;

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function rand(min: number, max: number, decimals = 1): number {
  const v = min + Math.random() * (max - min);
  const p = Math.pow(10, decimals);
  return Math.round(v * p) / p;
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

async function clearSeed() {
  console.log("Clearing seeded data...");
  await pool.query(`DELETE FROM daily_log WHERE notes = 'SEED_DATA'`);
  await pool.query(`DELETE FROM readiness_daily WHERE drivers::text LIKE '%SEED_DATA%'`);
  await pool.query(`DELETE FROM androgen_proxy_daily WHERE proxy_score IS NOT NULL AND computed_at < '2020-01-01'`);
  console.log("Cleared.");
}

async function seed() {
  console.log(`Seeding ${SEED_DAYS} days of dev data...`);

  let weight = rand(178, 185, 1);
  let bf = rand(14.5, 16.5, 1);
  let hrv = randInt(35, 55);
  let rhr = randInt(56, 64);
  let sleepMin = randInt(380, 460);

  for (let i = SEED_DAYS; i >= 0; i--) {
    const day = dateStr(i);

    weight += rand(-0.4, 0.5, 1);
    weight = clamp(weight, 170, 195);
    bf += rand(-0.3, 0.3, 1);
    bf = clamp(bf, 12, 20);
    hrv += randInt(-5, 5);
    hrv = clamp(hrv, 20, 80);
    rhr += randInt(-2, 2);
    rhr = clamp(rhr, 48, 75);
    sleepMin += randInt(-30, 30);
    sleepMin = clamp(sleepMin, 300, 540);

    const steps = randInt(4000, 14000);
    const cardio = randInt(0, 60);
    const liftDone = Math.random() > 0.3;
    const adherence = rand(0.7, 1.0, 2);
    const waterL = rand(2.0, 4.0, 1);

    const bfR1 = rand(bf - 0.5, bf + 0.5, 1);
    const bfR2 = rand(bf - 0.5, bf + 0.5, 1);
    const bfR3 = rand(bf - 0.5, bf + 0.5, 1);
    const bfAvg = Math.round(((bfR1 + bfR2 + bfR3) / 3) * 10) / 10;
    const leanMass = Math.round(weight * (1 - bfAvg / 100) * 10) / 10;
    const fatMass = Math.round(weight * (bfAvg / 100) * 10) / 10;

    await pool.query(`
      INSERT INTO daily_log (
        day, morning_weight_lb, waist_in,
        bf_morning_r1, bf_morning_r2, bf_morning_r3, bf_morning_pct,
        sleep_minutes, sleep_quality,
        water_liters, steps, cardio_min, lift_done, deload_week,
        adherence, resting_hr, hrv, notes
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7,
        $8, $9,
        $10, $11, $12, $13, false,
        $14, $15, $16, 'SEED_DATA'
      ) ON CONFLICT (day) DO NOTHING
    `, [
      day, weight, rand(32.5, 34.5, 1),
      bfR1, bfR2, bfR3, bfAvg,
      sleepMin, randInt(60, 95),
      waterL, steps, cardio, liftDone,
      adherence, rhr, hrv
    ]);

    await pool.query(`
      INSERT INTO dashboard_cache (day, lean_mass_lb, fat_mass_lb, weight_7d_avg, waist_7d_avg)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (day) DO NOTHING
    `, [day, leanMass, fatMass, weight, rand(33.0, 34.0, 1)]);

    const proxyScore = rand(40, 85, 1);
    const proxyAvg = rand(50, 75, 1);
    await pool.query(`
      INSERT INTO androgen_proxy_daily (date, proxy_score, proxy_7d_avg, computed_with_imputed, computed_at)
      VALUES ($1, $2, $3, false, '2019-01-01')
      ON CONFLICT (date, computed_with_imputed) DO NOTHING
    `, [day, proxyScore, proxyAvg]);

    const sleep7d = sleepMin + randInt(-20, 20);
    const sleep28d = sleepMin + randInt(-10, 10);
    const hrv7d = hrv + randInt(-5, 5);
    const hrv28d = hrv + randInt(-3, 3);
    const rhr7d = rhr + randInt(-2, 2);
    const rhr28d = rhr + randInt(-1, 1);
    const proxy7d = proxyAvg + rand(-5, 5, 1);
    const proxy28d = proxyAvg + rand(-3, 3, 1);

    const sleepSub = clamp(50 + ((sleep7d - sleep28d) / sleep28d) * 100 * 2, 0, 100);
    const hrvSub = clamp(50 + ((hrv7d - hrv28d) / hrv28d) * 100 * 2, 0, 100);
    const rhrSub = clamp(50 - ((rhr7d - rhr28d) / rhr28d) * 100 * 2, 0, 100);
    const proxySub = clamp(50 + ((proxy7d - proxy28d) / proxy28d) * 100 * 2, 0, 100);

    const rawScore = sleepSub * 0.2 + hrvSub * 0.3 + rhrSub * 0.2 + proxySub * 0.2;
    const readinessScore = clamp(Math.round(rawScore), 0, 100);
    const tier = readinessScore >= 75 ? "GREEN" : readinessScore >= 60 ? "YELLOW" : "BLUE";

    await pool.query(`
      INSERT INTO readiness_daily (
        date, readiness_score, readiness_tier, confidence_grade,
        hrv_delta, rhr_delta, sleep_delta, proxy_delta,
        hrv_7d, hrv_28d, rhr_7d, rhr_28d,
        sleep_7d, sleep_28d, proxy_7d, proxy_28d,
        drivers
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17::jsonb
      ) ON CONFLICT (date) DO NOTHING
    `, [
      day, readinessScore, tier, i < 7 ? "Low" : i < 28 ? "Med" : "High",
      hrv7d - hrv28d, rhr7d - rhr28d, sleep7d - sleep28d, proxy7d - proxy28d,
      hrv7d, hrv28d, rhr7d, rhr28d,
      sleep7d, sleep28d, proxy7d, proxy28d,
      JSON.stringify({ seeded: true, note: "SEED_DATA" })
    ]);
  }

  console.log(`Inserted ${SEED_DAYS + 1} days of seed data.`);
  console.log("Run 'npx tsx scripts/seed-dev.ts --clear' to remove seeded data.");
}

async function main() {
  try {
    if (process.argv.includes("--clear")) {
      await clearSeed();
    } else {
      await seed();
    }
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
