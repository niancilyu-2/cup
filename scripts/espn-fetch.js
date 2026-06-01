// ABOUTME: Fetches the ESPN World Cup scoreboard, or loads a fixture file for testing.
// ABOUTME: Returns the raw events array; parsing/normalization happens in espn-map.js.

import { readFile } from 'node:fs/promises';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

// Whole-tournament date range; ESPN accepts YYYYMMDD-YYYYMMDD.
const DEFAULT_RANGE = '20260611-20260719';

export async function fetchEspnEvents({ fixture, dates } = {}) {
  let json;
  if (fixture) {
    json = JSON.parse(await readFile(fixture, 'utf8'));
  } else {
    const range = dates || DEFAULT_RANGE;
    const res = await fetch(`${BASE}?dates=${range}`);
    if (!res.ok) throw new Error(`ESPN fetch failed: ${res.status}`);
    json = await res.json();
  }
  return json.events || [];
}
