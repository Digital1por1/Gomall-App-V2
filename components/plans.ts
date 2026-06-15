// Planes / créditos. Los "créditos" son las mismas unidades del límite mensual (tokenLimit).
// Costo interno por acción: imagen/mejorar/producto = 15.000 · campaña = 4.000 · copy = 2.000
export interface Plan {
  id: string;
  name: string;
  credits: number;   // = tokenLimit mensual
  images: number;    // referencia: imágenes aprox. (credits / 15000)
  desc: string;
}

export const PLANS: Plan[] = [
  { id: 'free', name: 'Free', credits: 1000000, images: 66, desc: '~66 imágenes/mes' },
];

export const DEFAULT_PLAN_ID = 'free';

export const planById = (id?: string): Plan | undefined => PLANS.find(p => p.id === id);
// Si no hay plan guardado, lo deducimos por el tokenLimit
export const planForProfile = (planId?: string, tokenLimit?: number): Plan | undefined =>
  planById(planId) || PLANS.find(p => p.credits === tokenLimit);
