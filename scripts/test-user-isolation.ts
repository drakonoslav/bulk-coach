import { pool, initDb } from "../server/db";

const USER_A = "smoke_user_alpha";
const USER_B = "smoke_user_beta";

async function cleanup() {
  for (const uid of [USER_A, USER_B]) {
    await pool.query(`DELETE FROM daily_log WHERE user_id = $1`, [uid]);
    await pool.query(`DELETE FROM dashboard_cache WHERE user_id = $1`, [uid]);
    await pool.query(`DELETE FROM vitals_daily WHERE user_id = $1`, [uid]);
    await pool.query(`DELETE FROM sleep_summary_daily WHERE user_id = $1`, [uid]);
    await pool.query(`DELETE FROM workout_session WHERE user_id = $1`, [uid]);
    await pool.query(`DELETE FROM workout_events WHERE user_id = $1`, [uid]);
    await pool.query(`DELETE FROM muscle_weekly_load WHERE user_id = $1`, [uid]);
    await pool.query(`DELETE FROM readiness_daily WHERE user_id = $1`, [uid]);
  }
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

async function run() {
  await initDb();
  console.log("=== User Isolation Smoke Test ===\n");

  await cleanup();
  console.log("Cleaned up test users.\n");

  console.log("--- 1. daily_log isolation ---");
  await pool.query(
    `INSERT INTO daily_log (user_id, day, morning_weight_lb) VALUES ($1, '2025-06-01', 185.0)`,
    [USER_A]
  );
  await pool.query(
    `INSERT INTO daily_log (user_id, day, morning_weight_lb) VALUES ($1, '2025-06-01', 210.0)`,
    [USER_B]
  );

  const { rows: aLogs } = await pool.query(
    `SELECT * FROM daily_log WHERE user_id = $1 AND day = '2025-06-01'`, [USER_A]
  );
  const { rows: bLogs } = await pool.query(
    `SELECT * FROM daily_log WHERE user_id = $1 AND day = '2025-06-01'`, [USER_B]
  );

  assert(aLogs.length === 1, "User A sees exactly 1 row");
  assert(bLogs.length === 1, "User B sees exactly 1 row");
  assert(parseFloat(aLogs[0].morning_weight_lb) === 185.0, "User A weight = 185.0");
  assert(parseFloat(bLogs[0].morning_weight_lb) === 210.0, "User B weight = 210.0");

  console.log("\n--- 2. vitals_daily isolation ---");
  await pool.query(
    `INSERT INTO vitals_daily (user_id, date, resting_hr_bpm, source) VALUES ($1, '2025-06-01', 58, 'test')`,
    [USER_A]
  );
  await pool.query(
    `INSERT INTO vitals_daily (user_id, date, resting_hr_bpm, source) VALUES ($1, '2025-06-01', 72, 'test')`,
    [USER_B]
  );

  const { rows: aVitals } = await pool.query(
    `SELECT * FROM vitals_daily WHERE user_id = $1 AND date = '2025-06-01'`, [USER_A]
  );
  const { rows: bVitals } = await pool.query(
    `SELECT * FROM vitals_daily WHERE user_id = $1 AND date = '2025-06-01'`, [USER_B]
  );

  assert(aVitals.length === 1, "User A vitals: 1 row");
  assert(bVitals.length === 1, "User B vitals: 1 row");
  assert(aVitals[0].resting_hr_bpm === 58, "User A RHR = 58");
  assert(bVitals[0].resting_hr_bpm === 72, "User B RHR = 72");

  console.log("\n--- 3. workout_session isolation ---");
  const sidA = `iso_test_a_${Date.now()}`;
  const sidB = `iso_test_b_${Date.now()}`;
  await pool.query(
    `INSERT INTO workout_session (session_id, user_id, date, start_ts, source, workout_type)
     VALUES ($1, $2, '2025-06-01', '2025-06-01T08:00:00Z', 'test', 'strength')`,
    [sidA, USER_A]
  );
  await pool.query(
    `INSERT INTO workout_session (session_id, user_id, date, start_ts, source, workout_type)
     VALUES ($1, $2, '2025-06-01', '2025-06-01T09:00:00Z', 'test', 'cardio')`,
    [sidB, USER_B]
  );

  const { rows: aSessions } = await pool.query(
    `SELECT * FROM workout_session WHERE user_id = $1`, [USER_A]
  );
  const { rows: bSessions } = await pool.query(
    `SELECT * FROM workout_session WHERE user_id = $1`, [USER_B]
  );

  assert(aSessions.length === 1, "User A sees 1 workout session");
  assert(bSessions.length === 1, "User B sees 1 workout session");
  assert(aSessions[0].workout_type === "strength", "User A workout = strength");
  assert(bSessions[0].workout_type === "cardio", "User B workout = cardio");

  console.log("\n--- 4. sleep_summary_daily isolation ---");
  await pool.query(
    `INSERT INTO sleep_summary_daily (user_id, date, total_sleep_minutes, source)
     VALUES ($1, '2025-06-01', 420, 'test')`,
    [USER_A]
  );
  await pool.query(
    `INSERT INTO sleep_summary_daily (user_id, date, total_sleep_minutes, source)
     VALUES ($1, '2025-06-01', 360, 'test')`,
    [USER_B]
  );

  const { rows: aSleep } = await pool.query(
    `SELECT * FROM sleep_summary_daily WHERE user_id = $1 AND date = '2025-06-01'`, [USER_A]
  );
  const { rows: bSleep } = await pool.query(
    `SELECT * FROM sleep_summary_daily WHERE user_id = $1 AND date = '2025-06-01'`, [USER_B]
  );

  assert(aSleep.length === 1, "User A sleep: 1 row");
  assert(bSleep.length === 1, "User B sleep: 1 row");
  assert(aSleep[0].total_sleep_minutes === 420, "User A sleep = 420 min");
  assert(bSleep[0].total_sleep_minutes === 360, "User B sleep = 360 min");

  console.log("\n--- 5. muscle_weekly_load isolation ---");
  await pool.query(
    `INSERT INTO muscle_weekly_load (user_id, muscle, week_start, hard_sets, total_sets)
     VALUES ($1, 'chest_upper', '2025-05-26', 8, 12)`,
    [USER_A]
  );
  await pool.query(
    `INSERT INTO muscle_weekly_load (user_id, muscle, week_start, hard_sets, total_sets)
     VALUES ($1, 'chest_upper', '2025-05-26', 4, 6)`,
    [USER_B]
  );

  const { rows: aLoad } = await pool.query(
    `SELECT * FROM muscle_weekly_load WHERE user_id = $1 AND muscle = 'chest_upper' AND week_start = '2025-05-26'`, [USER_A]
  );
  const { rows: bLoad } = await pool.query(
    `SELECT * FROM muscle_weekly_load WHERE user_id = $1 AND muscle = 'chest_upper' AND week_start = '2025-05-26'`, [USER_B]
  );

  assert(aLoad.length === 1, "User A muscle load: 1 row");
  assert(bLoad.length === 1, "User B muscle load: 1 row");
  assert(aLoad[0].hard_sets === 8, "User A hard_sets = 8");
  assert(bLoad[0].hard_sets === 4, "User B hard_sets = 4");

  console.log("\n--- 6. Cross-user invisibility ---");
  const { rows: aCross } = await pool.query(
    `SELECT * FROM daily_log WHERE user_id = $1`, [USER_A]
  );
  const { rows: bCross } = await pool.query(
    `SELECT * FROM daily_log WHERE user_id = $1`, [USER_B]
  );
  const aWeights = aCross.map(r => parseFloat(r.morning_weight_lb));
  const bWeights = bCross.map(r => parseFloat(r.morning_weight_lb));

  assert(!aWeights.includes(210.0), "User A cannot see User B's weight (210)");
  assert(!bWeights.includes(185.0), "User B cannot see User A's weight (185)");

  console.log("\n--- 7. ON CONFLICT composite key (upsert) ---");
  await pool.query(
    `INSERT INTO daily_log (user_id, day, morning_weight_lb) VALUES ($1, '2025-06-01', 190.0)
     ON CONFLICT (user_id, day) DO UPDATE SET morning_weight_lb = EXCLUDED.morning_weight_lb`,
    [USER_A]
  );
  const { rows: updatedA } = await pool.query(
    `SELECT morning_weight_lb FROM daily_log WHERE user_id = $1 AND day = '2025-06-01'`, [USER_A]
  );
  const { rows: unchangedB } = await pool.query(
    `SELECT morning_weight_lb FROM daily_log WHERE user_id = $1 AND day = '2025-06-01'`, [USER_B]
  );

  assert(parseFloat(updatedA[0].morning_weight_lb) === 190.0, "User A upserted to 190.0");
  assert(parseFloat(unchangedB[0].morning_weight_lb) === 210.0, "User B unchanged at 210.0");

  await cleanup();
  console.log("\nCleaned up test data.\n");

  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test error:", err);
    process.exit(1);
  });
