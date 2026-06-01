// ABOUTME: Maps ESPN scoreboard team names + statuses onto our FIFA codes/match model.
// ABOUTME: Pure helpers — no network. The name map is hand-built; unknowns log upstream.

// Canonical names match teams.name in seed.sql; aliases cover ESPN's variants.
// One entry per accepted string → 3-letter FIFA code (teams.code primary key).
export const ESPN_NAME_TO_CODE = {
  'Mexico': 'MEX',
  'South Africa': 'RSA',
  'South Korea': 'KOR', 'Korea Republic': 'KOR',
  'Czech Republic': 'CZE', 'Czechia': 'CZE',
  'Canada': 'CAN',
  'Bosnia and Herzegovina': 'BIH', 'Bosnia & Herzegovina': 'BIH', 'Bosnia-Herzegovina': 'BIH',
  'Qatar': 'QAT',
  'Switzerland': 'SUI',
  'Brazil': 'BRA',
  'Morocco': 'MAR',
  'Haiti': 'HAI',
  'Scotland': 'SCO',
  'United States': 'USA', 'USA': 'USA',
  'Paraguay': 'PAR',
  'Australia': 'AUS',
  'Turkey': 'TUR', 'Türkiye': 'TUR', 'Turkiye': 'TUR',
  'Germany': 'GER',
  'Curaçao': 'CUW', 'Curacao': 'CUW',
  'Ivory Coast': 'CIV', "Côte d'Ivoire": 'CIV', "Cote d'Ivoire": 'CIV',
  'Ecuador': 'ECU',
  'Netherlands': 'NED',
  'Japan': 'JPN',
  'Sweden': 'SWE',
  'Tunisia': 'TUN',
  'Belgium': 'BEL',
  'Egypt': 'EGY',
  'Iran': 'IRN', 'IR Iran': 'IRN',
  'New Zealand': 'NZL',
  'Spain': 'ESP',
  'Cape Verde': 'CPV', 'Cabo Verde': 'CPV',
  'Saudi Arabia': 'KSA',
  'Uruguay': 'URU',
  'France': 'FRA',
  'Senegal': 'SEN',
  'Iraq': 'IRQ',
  'Norway': 'NOR',
  'Argentina': 'ARG',
  'Algeria': 'ALG',
  'Austria': 'AUT',
  'Jordan': 'JOR',
  'Portugal': 'POR',
  'DR Congo': 'COD', 'Congo DR': 'COD', 'DR Congo (Congo-Kinshasa)': 'COD',
  'Uzbekistan': 'UZB',
  'Colombia': 'COL',
  'England': 'ENG',
  'Croatia': 'CRO',
  'Ghana': 'GHA',
  'Panama': 'PAN',
};

export function teamCodeFromEspn(name) {
  if (!name) return null;
  return ESPN_NAME_TO_CODE[name.trim()] || null;
}

export function classifyStatus(type) {
  if (!type) return 'scheduled';
  if (type.state === 'post' && type.completed === true) return 'final';
  if (type.state === 'pre') return 'scheduled';
  return 'in_progress';
}

function dateToUTCStamp(iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function normalizeEspnEvent(event) {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  const teamA = teamCodeFromEspn(home.team?.displayName);
  const teamB = teamCodeFromEspn(away.team?.displayName);
  if (!teamA || !teamB) return null;

  const status = classifyStatus(comp.status?.type);
  const scoreA = home.score == null || home.score === '' ? null : Number(home.score);
  const scoreB = away.score == null || away.score === '' ? null : Number(away.score);

  let winnerCode = null;
  if (status === 'final') {
    if (home.winner === true) winnerCode = teamA;
    else if (away.winner === true) winnerCode = teamB;
  }

  return {
    dateUTC: dateToUTCStamp(event.date),
    teamA, teamB, scoreA, scoreB, status, winnerCode,
  };
}
