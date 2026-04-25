import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      emergency: {
        title: 'Emergency Report',
        describe: 'What\'s happening?',
        location: 'Your Location',
        confirm: 'Confirm Report',
        submit: 'Submit Emergency',
        submitted: 'Help is on the way',
        reference: 'Reference Code',
      },
      tracking: {
        title: 'Incident Tracking',
        eta: 'Estimated Arrival',
        status: 'Status',
        timeline: 'Response Timeline',
      },
      common: {
        back: 'Back',
        continue: 'Continue',
        loading: 'Loading...',
        error: 'An error occurred',
      },
    },
  },
  es: {
    translation: {
      emergency: {
        title: 'Reporte de Emergencia',
        describe: '¿Qué está pasando?',
        location: 'Tu Ubicación',
        confirm: 'Confirmar Reporte',
        submit: 'Enviar Emergencia',
        submitted: 'La ayuda está en camino',
        reference: 'Código de Referencia',
      },
      tracking: {
        title: 'Seguimiento de Incidente',
        eta: 'Llegada Estimada',
        status: 'Estado',
        timeline: 'Cronología de Respuesta',
      },
      common: {
        back: 'Atrás',
        continue: 'Continuar',
        loading: 'Cargando...',
        error: 'Ocurrió un error',
      },
    },
  },
  fr: {
    translation: {
      emergency: {
        title: 'Rapport d\'Urgence',
        describe: 'Que se passe-t-il?',
        location: 'Votre Emplacement',
        confirm: 'Confirmer le Rapport',
        submit: 'Soumettre l\'Urgence',
        submitted: 'Les secours arrivent',
        reference: 'Code de Référence',
      },
    },
  },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: navigator.language.split('-')[0] ?? 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
