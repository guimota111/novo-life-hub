import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    // No Firebase App Hosting, o Application Default Credentials (ADC) é usado automaticamente.
    admin.initializeApp({
      projectId: 'tamagochi-db43c',
    });
  } catch (error: any) {
    console.error('Erro ao inicializar o Firebase Admin:', error.stack);
  }
}

export const adminDb = admin.firestore();
