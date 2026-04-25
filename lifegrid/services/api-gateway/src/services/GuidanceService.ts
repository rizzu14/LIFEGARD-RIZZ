import { v4 as uuidv4 } from 'uuid';
import type { GuidanceSession, GuidanceMessage, IncidentType, IncidentSeverity } from '@lifegrid/shared-types';
import { DatabaseManager } from '../database/DatabaseManager';

// Multilingual guidance templates
const GUIDANCE_TEMPLATES: Record<string, Record<string, string[]>> = {
  en: {
    MEDICAL: [
      'Help is on the way. Stay calm and keep the person still.',
      'If the person is unconscious, check for breathing. Do not move them unless in immediate danger.',
      'If trained, begin CPR if there is no pulse. Responders will guide you.',
      'Keep the area clear and ensure easy access for emergency vehicles.',
    ],
    FIRE: [
      'Evacuate the building immediately. Do not use elevators.',
      'Stay low to avoid smoke inhalation. Cover your mouth with cloth if available.',
      'Do not re-enter the building for any reason.',
      'Move to the designated assembly point and wait for responders.',
    ],
    SECURITY: [
      'Move to a safe location away from the threat.',
      'Do not confront the threat. Your safety is the priority.',
      'Lock doors if possible and stay away from windows.',
      'Responders are en route. Stay on the line.',
    ],
    DEFAULT: [
      'Help is on the way. Please stay calm.',
      'Remain at your current location unless in immediate danger.',
      'Keep this line open for further instructions.',
      'Responders have been notified and are en route.',
    ],
  },
  es: {
    DEFAULT: [
      'La ayuda está en camino. Por favor, mantenga la calma.',
      'Permanezca en su ubicación actual a menos que esté en peligro inmediato.',
      'Mantenga esta línea abierta para más instrucciones.',
    ],
  },
  fr: {
    DEFAULT: [
      'Les secours arrivent. Restez calme.',
      'Restez à votre emplacement actuel sauf danger immédiat.',
      'Gardez cette ligne ouverte pour d\'autres instructions.',
    ],
  },
  ar: {
    DEFAULT: [
      'المساعدة في الطريق. يرجى البقاء هادئاً.',
      'ابق في موقعك الحالي ما لم تكن في خطر فوري.',
    ],
  },
};

interface StartSessionParams {
  incidentId: string;
  language: string;
  channel: 'VOICE' | 'SMS' | 'APP' | 'CHAT';
  incidentType: IncidentType;
  severity: IncidentSeverity;
  estimatedArrival?: number;
}

export class GuidanceService {
  static async startSession(params: StartSessionParams): Promise<GuidanceSession> {
    const sessionId = uuidv4();
    const lang = params.language in GUIDANCE_TEMPLATES ? params.language : 'en';
    const templates = GUIDANCE_TEMPLATES[lang];
    const messages = templates[params.incidentType] ?? templates.DEFAULT ?? [];

    const etaText = params.estimatedArrival
      ? ` Estimated arrival: ${Math.round(params.estimatedArrival / 60)} minutes.`
      : '';

    const guidanceMessages: GuidanceMessage[] = messages.map((content, i) => ({
      messageId: uuidv4(),
      role: 'SYSTEM',
      content: i === 0 ? content + etaText : content,
      language: lang,
      timestamp: new Date(Date.now() + i * 2000).toISOString(),
      isRead: false,
    }));

    const session: GuidanceSession = {
      sessionId,
      incidentId: params.incidentId,
      language: lang,
      startedAt: new Date().toISOString(),
      channel: params.channel,
      messages: guidanceMessages,
    };

    // Persist session
    await DatabaseManager.query(
      `INSERT INTO lifegrid.guidance_sessions (id, incident_id, language, channel, started_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, params.incidentId, lang, params.channel, session.startedAt],
    );

    for (const msg of guidanceMessages) {
      await DatabaseManager.query(
        `INSERT INTO lifegrid.guidance_messages (id, session_id, role, content, language, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [msg.messageId, sessionId, msg.role, msg.content, msg.language, msg.timestamp],
      );
    }

    return session;
  }

  static async addMessage(
    sessionId: string,
    role: 'OPERATOR' | 'CITIZEN',
    content: string,
    language: string,
  ): Promise<GuidanceMessage> {
    const message: GuidanceMessage = {
      messageId: uuidv4(),
      role,
      content,
      language,
      timestamp: new Date().toISOString(),
      isRead: false,
    };

    await DatabaseManager.query(
      `INSERT INTO lifegrid.guidance_messages (id, session_id, role, content, language, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [message.messageId, sessionId, role, content, language, message.timestamp],
    );

    return message;
  }
}
