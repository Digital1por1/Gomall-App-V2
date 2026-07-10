// Planes. El medidor INTERNO sigue en "tokens" (tokenLimit), pero de cara al usuario TODO se muestra en IMÁGENES.
// Costo interno por acción: imagen/mejorar/producto = 15.000 · campaña = 4.000 · copy = 2.000
export const IMAGE_COST = 15000; // tokens que "pesa" una imagen → base para convertir tokens ↔ imágenes
export const imagesToTokens = (images: number): number => Math.round(images * IMAGE_COST);
export const tokensToImages = (tokens?: number): number => Math.floor((tokens || 0) / IMAGE_COST);

export interface Plan {
  id: string;
  name: string;
  images: number;    // imágenes IA por mes (la métrica que ve el usuario)
  credits: number;   // = tokenLimit mensual (interno)
  priceUsd: number;  // precio mensual en USD (0 = gratis)
  desc: string;
}

// Precios en USD (por ahora); el método de pago se define después.
// Copys, campañas, reels, voz en off y subtítulos: ILIMITADOS en todos los planes (costo ~0 para nosotros).
export const PLANS: Plan[] = [
  { id: 'free',     name: 'Gratis',   images: 20,  credits: imagesToTokens(20),  priceUsd: 0,  desc: '20 imágenes/mes · reels y voz ilimitados' },
  { id: 'comercio', name: 'Comercio', images: 100, credits: imagesToTokens(100), priceUsd: 12, desc: '100 imágenes/mes · todo lo demás ilimitado' },
  { id: 'marca',    name: 'Marca',    images: 300, credits: imagesToTokens(300), priceUsd: 29, desc: '300 imágenes/mes · todo ilimitado + prioridad' },
];

export const DEFAULT_PLAN_ID = 'free';

export const planById = (id?: string): Plan | undefined => PLANS.find(p => p.id === id);
// Si no hay plan guardado, lo deducimos por el tokenLimit
export const planForProfile = (planId?: string, tokenLimit?: number): Plan | undefined =>
  planById(planId) || PLANS.find(p => p.credits === tokenLimit);
