import type { VesselState } from '../types/index.ts';
import { decodeFlagFromMMSI } from './mmsi-decoder.ts';

/**
 * Shadow fleet risk scoring - calculates a risk score (0-100) for a vessel.
 *
 * Scoring criteria:
 * - Ship type 80-89 (tanker)              = base 20
 * - Flag of convenience                   = +20
 * - Destination is Russian port           = +15
 * - Zone is norway_murmansk               = +10
 * - AIS gap > 1 hour                      = +15
 * - Suspicious vessel name                = +10
 * - Anchored in open water (nav_status=1) = +10
 */

// Russian ports commonly used for sanctioned oil trade
const RUSSIAN_PORTS = [
  'MURMANSK',
  'NOVOROSSIYSK',
  'PRIMORSK',
  'UST-LUGA',
  'KOZMINO',
  'NAKHODKA',
  'VOSTOCHNY',
  'DE KASTRI',
  'TUAPSE',
  'TAMAN',
  'KAVKAZ',
  'VYSOTSK',
  'ST PETERSBURG',
  'SAINT PETERSBURG',
  'VLADIVOSTOK',
];

// Flags of convenience specifically linked to shadow fleet operations
const SHADOW_FLEET_FLAGS = new Set([
  'PA', // Panama
  'LR', // Liberia
  'MH', // Marshall Islands
  'CM', // Cameroon
  'PW', // Palau
  'GA', // Gabon
  'KM', // Comoros
  'TZ', // Tanzania
  'TG', // Togo
  'SL', // Sierra Leone
]);

// Suspicious name patterns - generic single-word all-caps names often used by shadow fleet
const SUSPICIOUS_NAME_PATTERNS = [
  /^[A-Z]{3,12}$/,                        // Single all-caps word (GLORY, TRUST, etc.)
  /^[A-Z]+ [IVX]+$/,                      // Name + Roman numeral (VICTORY II)
  /^(UNKNOWN|UNAVAILABLE|N\/A|NONE)$/i,    // Missing name
  /^\d+$/,                                 // Just numbers
];

// Generic vessel names commonly used by shadow fleet
const SUSPICIOUS_NAMES = new Set([
  'GLORY', 'TRUST', 'FORTUNE', 'VICTORY', 'LIBERTY',
  'UNITY', 'HOPE', 'GRACE', 'STAR', 'OCEAN',
  'PHOENIX', 'EAGLE', 'DIAMOND', 'CROWN', 'ROYAL',
]);

interface RiskFactors {
  isTanker: boolean;
  flagOfConvenience: boolean;
  russianDestination: boolean;
  inMurmanskZone: boolean;
  aisGap: boolean;
  suspiciousName: boolean;
  anchoredOpenWater: boolean;
}

export interface RiskAssessment {
  score: number;
  factors: RiskFactors;
  level: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Calculate the risk score for a vessel.
 *
 * @param vessel - Current vessel state
 * @param aisGapMinutes - Minutes since last AIS position (0 = just received)
 * @returns Risk assessment with score, factors, and level
 */
export function calculateRiskScore(
  vessel: VesselState,
  aisGapMinutes: number = 0,
): RiskAssessment {
  let score = 0;
  const factors: RiskFactors = {
    isTanker: false,
    flagOfConvenience: false,
    russianDestination: false,
    inMurmanskZone: false,
    aisGap: false,
    suspiciousName: false,
    anchoredOpenWater: false,
  };

  // Ship type 80-89 = tanker
  if (vessel.shipType >= 80 && vessel.shipType <= 89) {
    score += 20;
    factors.isTanker = true;
  }

  // Flag of convenience check (using MMSI-decoded flag or stored flag)
  const flagInfo = decodeFlagFromMMSI(vessel.mmsi);
  if (flagInfo.isFlagOfConvenience || SHADOW_FLEET_FLAGS.has(flagInfo.code)) {
    score += 20;
    factors.flagOfConvenience = true;
  }

  // Destination is a Russian port
  const destUpper = (vessel.destination || '').toUpperCase().trim();
  if (destUpper && RUSSIAN_PORTS.some((port) => destUpper.includes(port))) {
    score += 15;
    factors.russianDestination = true;
  }

  // Currently in Norway-Murmansk corridor
  if (vessel.zone === 'norway_murmansk') {
    score += 10;
    factors.inMurmanskZone = true;
  }

  // AIS message gap > 60 minutes
  if (aisGapMinutes > 60) {
    score += 15;
    factors.aisGap = true;
  }

  // Suspicious vessel name
  const nameUpper = (vessel.name || '').toUpperCase().trim();
  const hasSuspiciousPattern = SUSPICIOUS_NAME_PATTERNS.some((p) => p.test(nameUpper));
  const hasSuspiciousName = SUSPICIOUS_NAMES.has(nameUpper);
  if (hasSuspiciousPattern || hasSuspiciousName) {
    score += 10;
    factors.suspiciousName = true;
  }

  // Anchored in open water (nav_status 1 = at anchor, but not near a port)
  // Heuristic: if anchored and speed < 0.5 knots and in one of our monitored zones
  if (vessel.navStatus === 1 && vessel.speed < 0.5 && vessel.zone !== null) {
    score += 10;
    factors.anchoredOpenWater = true;
  }

  // Cap at 100
  score = Math.min(score, 100);

  // Determine risk level
  let level: RiskAssessment['level'];
  if (score >= 70) {
    level = 'critical';
  } else if (score >= 50) {
    level = 'high';
  } else if (score >= 30) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { score, factors, level };
}
