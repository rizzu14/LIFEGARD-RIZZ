// ============================================================
// LIFEGRID – AI Engine HTTP Client (for AI Processing Service)
// ============================================================

import axios, { AxiosInstance } from 'axios';

const AI_ENGINE_URL = process.env.AI_ENGINE_URL ?? 'http://localhost:5001';
const TIMEOUT_MS    = parseInt(process.env.AI_ENGINE_TIMEOUT_MS ?? '5000', 10);

const http: AxiosInstance = axios.create({
  baseURL: AI_ENGINE_URL,
  timeout: TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

export const AIEngineClient = {
  async analyzeText(text: string, language = 'en'): Promise<any> {
    const res = await http.post('/nlp/analyze', { text, language });
    return res.data;
  },

  async makeDispatchDecision(payload: {
    incident_location: { lat: number; lng: number };
    incident_type: string;
    incident_severity: string;
    available_responders: any[];
    nlp_urgency_score: number;
  }): Promise<any> {
    const res = await http.post('/dispatch/decide', payload);
    return res.data;
  },

  async predictFlood(payload: any): Promise<any> {
    const res = await http.post('/predict/flood', payload, { timeout: 10000 });
    return res.data;
  },

  async predictWeather(payload: any): Promise<any> {
    const res = await http.post('/predict/weather', payload);
    return res.data;
  },

  async analyzeNDVI(payload: any): Promise<any> {
    const res = await http.post('/predict/ndvi', payload, { timeout: 8000 });
    return res.data;
  },
};
