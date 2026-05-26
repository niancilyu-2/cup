// ABOUTME: Synthetic tournament results for previewing the bracket "live" state.
// ABOUTME: Hardcoded outcomes per match; replaced by real results pipeline in Phase 4.

window.MOCK_TOURNAMENT = {
  // 'not_started' hides all overlays; 'in_progress' / 'completed' enables them.
  status: 'in_progress',
  asOfLabel: 'After Semifinals',

  // Group advancers (top 2 + best-8 third-places). Currently unused by the
  // bracket overlay (the bracket renders from user picks), but kept here for
  // the Phase-4 schema so the real data swap is a same-shape replacement.
  groupOutcomes: {
    A: { first: 'MEX', second: 'KOR', third: 'RSA', third_advances: true },
    B: { first: 'SUI', second: 'CAN', third: 'QAT', third_advances: false },
    C: { first: 'BRA', second: 'MAR', third: 'SCO', third_advances: true },
    D: { first: 'USA', second: 'AUS', third: 'PAR', third_advances: true },
    E: { first: 'GER', second: 'ECU', third: 'CIV', third_advances: true },
    F: { first: 'NED', second: 'JPN', third: 'TUN', third_advances: false },
    G: { first: 'BEL', second: 'IRN', third: 'EGY', third_advances: false },
    H: { first: 'ESP', second: 'URU', third: 'KSA', third_advances: true },
    I: { first: 'FRA', second: 'SEN', third: 'NOR', third_advances: true },
    J: { first: 'ARG', second: 'AUT', third: 'ALG', third_advances: false },
    K: { first: 'POR', second: 'COL', third: 'UZB', third_advances: true },
    L: { first: 'ENG', second: 'CRO', third: 'PAN', third_advances: true },
  },

  // Knockout results keyed by match id. `played: true` → overlay score+winner.
  // `played: false` (or absent) → render normally (no overlay).
  matchResults: {
    // R32 (M73..M88)
    M73: { winner: 'KOR', score: '1-0', played: true },
    M74: { winner: 'GER', score: '3-1', played: true },
    M75: { winner: 'NED', score: '2-0', played: true },
    M76: { winner: 'BRA', score: '4-1', played: true },
    M77: { winner: 'FRA', score: '2-1', played: true },
    M78: { winner: 'ECU', score: '1-0', played: true },
    M79: { winner: 'MEX', score: '2-1', played: true },
    M80: { winner: 'ENG', score: '3-0', played: true },
    M81: { winner: 'USA', score: '2-1', played: true },
    M82: { winner: 'BEL', score: '2-0', played: true },
    M83: { winner: 'CRO', score: '1-0', played: true },
    M84: { winner: 'ESP', score: '4-0', played: true },
    M85: { winner: 'SUI', score: '1-0', played: true },
    M86: { winner: 'ARG', score: '3-1', played: true },
    M87: { winner: 'POR', score: '2-1', played: true },
    M88: { winner: 'AUS', score: '2-1', played: true },

    // R16 (M89..M96)
    M89: { winner: 'GER', score: '2-1', played: true },
    M90: { winner: 'BRA', score: '2-0', played: true },
    M91: { winner: 'FRA', score: '3-1', played: true },
    M92: { winner: 'MEX', score: '2-1', played: true },
    M93: { winner: 'ENG', score: '1-0', played: true },
    M94: { winner: 'ESP', score: '2-0', played: true },
    M95: { winner: 'ARG', score: '2-1', played: true },
    M96: { winner: 'POR', score: '2-1', played: true },

    // Quarterfinals (M97..M100)
    M97:  { winner: 'BRA', score: '2-1', played: true },
    M98:  { winner: 'FRA', score: '2-0', played: true },
    M99:  { winner: 'ESP', score: '3-2', played: true },
    M100: { winner: 'ARG', score: '2-1', played: true },

    // Semifinals (M101, M102)
    M101: { winner: 'BRA', score: '2-1', played: true },
    M102: { winner: 'FRA', score: '1-0', played: true },

    // 3rd place (M103) and Final (M104) — not yet played.
    M103: { winner: null, score: null, played: false },
    M104: { winner: null, score: null, played: false },
  },
};
