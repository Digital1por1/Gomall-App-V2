import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/storage';

/**
 * Sube una imagen a Firebase Storage y devuelve su URL pública.
 * - Si ya es una URL (http/https), la devuelve tal cual (idempotente).
 * - Si es un data:base64, la sube a assets/{uid}/{folder}/ y devuelve la URL.
 * - Si algo falla, devuelve el original (base64) para no romper nada.
 * folder: 'logos' | 'recursos' | 'fondos' | 'disenos' | 'thumbs'
 */
export async function persistImage(src: string | null | undefined, folder: string): Promise<string | null> {
  if (!src) return src ?? null;
  if (!src.startsWith('data:')) return src; // ya es URL u otra cosa servible
  const user = firebase.auth().currentUser;
  if (!user) return src;
  try {
    const blob = await (await fetch(src)).blob();
    const mime = blob.type || 'image/png';
    const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
    const ref = firebase.storage().ref(`assets/${user.uid}/${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
    const snap = await ref.put(blob);
    return await snap.ref.getDownloadURL();
  } catch (e) {
    console.warn('persistImage: no se pudo subir a Storage, se mantiene base64.', e);
    return src;
  }
}

/** Sube un array de imágenes (logos/recursos), devolviendo URLs. */
export async function persistImages(arr: string[] | undefined, folder: string): Promise<string[]> {
  if (!arr || arr.length === 0) return arr || [];
  return Promise.all(arr.map((s) => persistImage(s, folder).then((u) => u || s)));
}
