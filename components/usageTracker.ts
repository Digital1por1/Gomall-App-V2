import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

export interface ApiUsage {
  prompt: number;
  output: number;
  total: number;
}

/**
 * Registra el consumo REAL de tokens (devuelto por Gemini en usageMetadata)
 * en el perfil del usuario, desglosado por acción. No debe romper la generación.
 * action: 'imagen' | 'mejorar' | 'copy' | 'campana' | 'producto' | 'analisis_web' | 'imagen_simple'
 */
export async function recordUsage(action: string, usage?: ApiUsage | null) {
  const user = firebase.auth().currentUser;
  if (!user || !usage || !usage.total) return;
  try {
    const inc = firebase.firestore.FieldValue.increment;
    await firebase.firestore().collection('profiles').doc(user.uid).update({
      [`usageStats.${action}.calls`]: inc(1),
      [`usageStats.${action}.tokens`]: inc(usage.total),
      'usageStats.totalTokens': inc(usage.total),
      'usageStats.totalCalls': inc(1),
      'usageStats.lastUpdated': Date.now(),
    });
  } catch (e) {
    // Silencioso: el tracking nunca debe interrumpir al usuario.
    console.warn('No se pudo registrar el consumo:', e);
  }
}
