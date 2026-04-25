// ============================================================
// LIFEGRID – AI Emergency Classifier
// Detects emergency type from voice/text input in real time.
// Updates Live Status Panel dynamically.
// Works fully offline — no backend required.
// ============================================================

import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';

export type EmergencyType =
  | 'MEDICAL'
  | 'FIRE'
  | 'SECURITY'
  | 'FLOOD'
  | 'CHEMICAL'
  | 'NATURAL_DISASTER'
  | 'MISSING_PERSON'
  | 'INFRASTRUCTURE'
  | 'UNKNOWN';

export interface ClassificationResult {
  type:        EmergencyType;
  label:       string;
  icon:        string;
  confidence:  number;
  color:       string;
  keywords:    string[];
}

// ── Classification rules ──────────────────────────────────────

const RULES: Array<{
  type:     EmergencyType;
  label:    string;
  icon:     string;
  color:    string;
  patterns: RegExp[];
}> = [
  {
    type: 'MEDICAL', label: 'Medical Emergency', icon: '🚑', color: '#dc2626',
    patterns: [
      /not breathing|no pulse|cardiac arrest|heart attack|chest pain/i,
      /unconscious|unresponsive|passed out|fainted/i,
      /bleeding|blood|wound|injury|injured|hurt/i,
      /seizure|stroke|overdose|allergic|anaphylaxis/i,
      /medical|ambulance|doctor|hospital|pain/i,
      /baby|infant|child.*sick|choking/i,
    ],
  },
  {
    type: 'FIRE', label: 'Fire Emergency', icon: '🔥', color: '#ea580c',
    patterns: [
      /fire|smoke|burning|flames|blaze|arson/i,
      /explosion|gas leak|carbon monoxide/i,
      /building.*fire|house.*fire|car.*fire/i,
    ],
  },
  {
    type: 'SECURITY', label: 'Security Threat', icon: '🚨', color: '#7c3aed',
    patterns: [
      /shooting|gunshot|gun|weapon|armed/i,
      /robbery|theft|stolen|burglar/i,
      /attack|assault|violence|fight|stabbing/i,
      /bomb|threat|hostage|kidnap/i,
      /suspicious|intruder|break.?in/i,
    ],
  },
  {
    type: 'FLOOD', label: 'Flood / Water', icon: '🌊', color: '#0284c7',
    patterns: [
      /flood|flooding|water rising|submerged/i,
      /tsunami|storm surge|flash flood/i,
      /trapped.*water|water.*trapped/i,
    ],
  },
  {
    type: 'CHEMICAL', label: 'Chemical Hazard', icon: '☣️', color: '#ca8a04',
    patterns: [
      /chemical|toxic|hazmat|poison|fumes/i,
      /gas leak|ammonia|chlorine|acid spill/i,
      /radiation|nuclear|contamination/i,
    ],
  },
  {
    type: 'NATURAL_DISASTER', label: 'Natural Disaster', icon: '🌪️', color: '#0f766e',
    patterns: [
      /earthquake|tremor|aftershock/i,
      /tornado|hurricane|cyclone|typhoon/i,
      /landslide|avalanche|mudslide/i,
      /disaster|catastrophe/i,
    ],
  },
  {
    type: 'MISSING_PERSON', label: 'Missing Person', icon: '👤', color: '#6b7280',
    patterns: [
      /missing|lost.*child|child.*lost|missing.*person/i,
      /can't find|cannot find|disappeared/i,
      /abducted|kidnapped/i,
    ],
  },
  {
    type: 'INFRASTRUCTURE', label: 'Infrastructure', icon: '⚡', color: '#d97706',
    patterns: [
      /power outage|blackout|electricity/i,
      /bridge.*collapse|road.*collapse|building.*collapse/i,
      /gas.*leak|water.*main|pipe.*burst/i,
    ],
  },
];

// ── Classifier ────────────────────────────────────────────────

export function classifyEmergency(text: string): ClassificationResult {
  if (!text || text.trim().length < 3) {
    return { type: 'UNKNOWN', label: 'Emergency', icon: '⚠️', color: '#6b7280', confidence: 0, keywords: [] };
  }

  let bestMatch = { score: 0, rule: RULES[RULES.length - 1], keywords: [] as string[] };

  for (const rule of RULES) {
    let score = 0;
    const matched: string[] = [];

    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match) {
        score += match[0].split(' ').length;  // longer phrase = higher score
        matched.push(match[0]);
      }
    }

    if (score > bestMatch.score) {
      bestMatch = { score, rule, keywords: matched };
    }
  }

  const confidence = Math.min(0.5 + bestMatch.score * 0.15, 0.98);

  return {
    type:       bestMatch.rule.type,
    label:      bestMatch.rule.label,
    icon:       bestMatch.rule.icon,
    color:      bestMatch.rule.color,
    confidence,
    keywords:   bestMatch.keywords,
  };
}

// ── Hook ──────────────────────────────────────────────────────

export function useEmergencyClassifier() {
  const { updateCallSession, callSession } = useAppStore();
  const lastTextRef = useRef('');

  const classify = useCallback((text: string): ClassificationResult => {
    const result = classifyEmergency(text);

    // Only update store if classification changed
    if (text !== lastTextRef.current && result.type !== 'UNKNOWN') {
      lastTextRef.current = text;
      // Push to call session AI suggestions if active
      if (callSession) {
        const { addAISuggestion } = useAppStore.getState();
        addAISuggestion(`Detected: ${result.label} — ${result.icon}`);
      }
    }

    return result;
  }, [callSession]);

  return { classify, classifyEmergency };
}
