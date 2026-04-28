// ============================================================
// KISAN-KAVACH — Crisis Brain Engine
// Calculates agricultural risk from weather + crop stage
// ============================================================

export type WeatherCondition =
  | 'Clear' | 'Cloudy' | 'Light Rain' | 'Heavy Rain'
  | 'Heatwave' | 'Storm' | 'Frost' | 'Drought';

export type CropStage = 'Sowing' | 'Growing' | 'Harvesting';

export type Severity = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AgriRiskResult {
  severity:    Severity;
  title:       string;
  action:      string;
  actionHi:    string;   // Hindi
  actionTe:    string;   // Telugu
  icon:        string;
  voiceAlert:  string;   // Full TTS string
  color:       string;
  bgColor:     string;
}

export interface FarmerProfile {
  name:      string;
  aadhaar:   string;
  cropType:  string;
  cropStage: CropStage;
  lat:       number;
  lng:       number;
  village:   string;
  acres:     number;
}

// ── Mock AgriStack data ───────────────────────────────────────

export const MOCK_FARMER: FarmerProfile = {
  name:      'Ravi Kumar',
  aadhaar:   '****-****-1234',
  cropType:  'Wheat',
  cropStage: 'Harvesting',
  lat:       17.4435,
  lng:       78.3772,
  village:   'Kondapur, Hyderabad',
  acres:     5,
};

// ── Crisis Brain ──────────────────────────────────────────────

export function calculateAgriRisk(
  weather: WeatherCondition,
  cropStage: CropStage,
  cropType: string,
): AgriRiskResult {

  // CRITICAL rules
  if (weather === 'Heavy Rain' && cropStage === 'Harvesting') {
    return {
      severity:   'CRITICAL',
      title:      'Critical: Move Harvest Now!',
      action:     'Heavy rain in 90 min. Move your wheat to a dry shed immediately.',
      actionHi:   'भारी बारिश आ रही है। अपनी फसल को तुरंत सूखी जगह ले जाएं।',
      actionTe:   'భారీ వర్షం వస్తోంది. మీ పంటను వెంటనే పొడి స్థలానికి తరలించండి.',
      icon:       '🏚️',
      voiceAlert: `Alert: Heavy rain expected in 90 minutes. Your ${cropType} is in the harvesting stage. Please move the harvest to a dry area immediately.`,
      color:      '#dc2626',
      bgColor:    '#fef2f2',
    };
  }

  if (weather === 'Storm' && cropStage === 'Harvesting') {
    return {
      severity:   'CRITICAL',
      title:      'Storm Warning — Secure Crop!',
      action:     'Storm approaching. Secure all harvested crop and equipment.',
      actionHi:   'तूफान आ रहा है। सभी फसल और उपकरण सुरक्षित करें।',
      actionTe:   'తుఫాను వస్తోంది. అన్ని పంట మరియు పరికరాలను సురక్షితం చేయండి.',
      icon:       '⛈️',
      voiceAlert: `Storm warning. Secure your ${cropType} harvest and all farm equipment immediately.`,
      color:      '#7c3aed',
      bgColor:    '#f5f3ff',
    };
  }

  if (weather === 'Frost' && (cropStage === 'Growing' || cropStage === 'Sowing')) {
    return {
      severity:   'CRITICAL',
      title:      'Frost Alert — Protect Crops!',
      action:     'Frost tonight. Cover young plants with cloth or straw.',
      actionHi:   'आज रात पाला पड़ेगा। छोटे पौधों को कपड़े या पुआल से ढकें।',
      actionTe:   'ఈ రాత్రి మంచు పడుతుంది. చిన్న మొక్కలను గుడ్డ లేదా గడ్డితో కప్పండి.',
      icon:       '🥶',
      voiceAlert: `Frost alert tonight. Cover your ${cropType} plants with cloth or straw to prevent damage.`,
      color:      '#0284c7',
      bgColor:    '#f0f9ff',
    };
  }

  // HIGH rules
  if (weather === 'Heatwave' && cropStage === 'Growing') {
    return {
      severity:   'HIGH',
      title:      'Heatwave — Increase Irrigation',
      action:     'Temperature above 42°C. Irrigate fields twice today.',
      actionHi:   'तापमान 42°C से ऊपर है। आज खेत में दो बार सिंचाई करें।',
      actionTe:   'ఉష్ణోగ్రత 42°C పైన ఉంది. ఈ రోజు రెండుసార్లు నీరు పెట్టండి.',
      icon:       '🌡️',
      voiceAlert: `Heatwave alert. Temperature is above 42 degrees. Irrigate your ${cropType} fields twice today to prevent crop stress.`,
      color:      '#ea580c',
      bgColor:    '#fff7ed',
    };
  }

  if (weather === 'Drought' && cropStage === 'Growing') {
    return {
      severity:   'HIGH',
      title:      'Drought Stress Detected',
      action:     'No rain for 14 days. Use drip irrigation. Apply mulch.',
      actionHi:   '14 दिनों से बारिश नहीं। ड्रिप सिंचाई करें। मल्च लगाएं।',
      actionTe:   '14 రోజులుగా వర్షం లేదు. డ్రిప్ నీటిపారుదల వాడండి. మల్చ్ వేయండి.',
      icon:       '🏜️',
      voiceAlert: `Drought stress alert. No rainfall for 14 days. Use drip irrigation and apply mulch to protect your ${cropType}.`,
      color:      '#b45309',
      bgColor:    '#fffbeb',
    };
  }

  // MEDIUM rules
  if (weather === 'Heatwave' && cropStage === 'Sowing') {
    return {
      severity:   'MEDIUM',
      title:      'Delay Sowing — Too Hot',
      action:     'Soil temperature too high for germination. Wait 3 days.',
      actionHi:   'मिट्टी का तापमान अंकुरण के लिए बहुत अधिक है। 3 दिन प्रतीक्षा करें।',
      actionTe:   'మట్టి ఉష్ణోగ్రత మొలకెత్తడానికి చాలా ఎక్కువగా ఉంది. 3 రోజులు వేచి ఉండండి.',
      icon:       '⏳',
      voiceAlert: `Caution. Soil temperature is too high for sowing. Wait 3 days before planting your ${cropType} seeds.`,
      color:      '#d97706',
      bgColor:    '#fffbeb',
    };
  }

  if (weather === 'Heavy Rain' && cropStage === 'Growing') {
    return {
      severity:   'MEDIUM',
      title:      'Waterlogging Risk',
      action:     'Heavy rain may cause waterlogging. Open drainage channels.',
      actionHi:   'भारी बारिश से जलभराव हो सकता है। जल निकासी खोलें।',
      actionTe:   'భారీ వర్షం వల్ల నీరు నిలబడవచ్చు. నీటి పారుదల తెరవండి.',
      icon:       '💧',
      voiceAlert: `Waterlogging risk. Heavy rain may flood your ${cropType} field. Open drainage channels now.`,
      color:      '#0284c7',
      bgColor:    '#f0f9ff',
    };
  }

  // LOW rules
  if (weather === 'Heavy Rain' && cropStage === 'Sowing') {
    return {
      severity:   'LOW',
      title:      'Good Rain for Seeds',
      action:     'Rain is beneficial for sowing. Proceed with planting.',
      actionHi:   'बारिश बुवाई के लिए अच्छी है। बुवाई जारी रखें।',
      actionTe:   'వర్షం విత్తనాలకు మంచిది. నాటడం కొనసాగించండి.',
      icon:       '🌱',
      voiceAlert: `Good news. Rain is beneficial for your ${cropType} seeds. Proceed with sowing.`,
      color:      '#16a34a',
      bgColor:    '#f0fdf4',
    };
  }

  if (weather === 'Light Rain') {
    return {
      severity:   'LOW',
      title:      'Light Rain — Monitor Fields',
      action:     'Light rain expected. Good for crops. Monitor for excess water.',
      actionHi:   'हल्की बारिश की उम्मीद है। फसल के लिए अच्छा है।',
      actionTe:   'తేలికపాటి వర్షం వస్తుంది. పంటకు మంచిది.',
      icon:       '🌦️',
      voiceAlert: `Light rain expected. This is good for your ${cropType}. Monitor fields for excess water.`,
      color:      '#16a34a',
      bgColor:    '#f0fdf4',
    };
  }

  // SAFE default
  return {
    severity:   'SAFE',
    title:      'Fields are Safe',
    action:     'Weather conditions are favorable. No action needed.',
    actionHi:   'मौसम की स्थिति अनुकूल है। कोई कार्रवाई आवश्यक नहीं।',
    actionTe:   'వాతావరణ పరిస్థితులు అనుకూలంగా ఉన్నాయి. చర్య అవసరం లేదు.',
    icon:       '✅',
    voiceAlert: `Your ${cropType} fields are safe. Weather conditions are favorable today.`,
    color:      '#16a34a',
    bgColor:    '#f0fdf4',
  };
}

// ── Severity color helpers ────────────────────────────────────

export const SEVERITY_COLORS: Record<Severity, { bg: string; border: string; text: string; badge: string }> = {
  SAFE:     { bg: '#f0fdf4', border: '#86efac', text: '#15803d', badge: '#22c55e' },
  LOW:      { bg: '#f0fdf4', border: '#86efac', text: '#15803d', badge: '#22c55e' },
  MEDIUM:   { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', badge: '#f59e0b' },
  HIGH:     { bg: '#fff7ed', border: '#fdba74', text: '#9a3412', badge: '#f97316' },
  CRITICAL: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', badge: '#ef4444' },
};

// ── LocalStorage cache ────────────────────────────────────────

const CACHE_KEY = 'kisan_kavach_cache';

export function cacheStatus(data: object) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, cachedAt: new Date().toISOString() })); } catch { /* ignore */ }
}

export function getCachedStatus(): any | null {
  try { const d = localStorage.getItem(CACHE_KEY); return d ? JSON.parse(d) : null; } catch { return null; }
}
