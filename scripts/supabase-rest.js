// ABOUTME: Minimal Supabase PostgREST client for the sync script (Node, zero deps).
// ABOUTME: Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env; service role bypasses RLS.

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function headers() {
  if (!URL || !KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function selectMatches() {
  const url = `${URL}/rest/v1/matches?select=id,stage,group_code,kickoff_at,slot_a,slot_b,team_a_code,team_b_code,score_a,score_b,winner_code,completed,result_source&order=kickoff_at`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`selectMatches failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function patchMatch(id, fields) {
  const url = `${URL}/rest/v1/matches?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`patchMatch ${id} failed: ${res.status} ${await res.text()}`);
}
