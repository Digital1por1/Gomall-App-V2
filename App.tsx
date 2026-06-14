
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ProjectState, BackgroundConfig, UserProfile, TextLayer, SavedProject, CustomFont } from './types';
import SidebarModules from './components/SidebarModules';
import EditorCanvas from './components/EditorCanvas';
import QuickEditDrawer from './components/QuickEditDrawer';
import AdminDashboard from './components/AdminDashboard';
import BrandOnboarding from './components/BrandOnboarding';
import CampaignStudio from './components/CampaignStudio';
import ReelStudio from './components/ReelStudio';
import BrandSettings from './components/BrandSettings';
import CalendarStudio from './components/CalendarStudio';
import ProductAdStudio from './components/ProductAdStudio';
import * as htmlToImage from 'html-to-image';
import { CampaignPiece } from './types';

const ADMIN_EMAILS = ['digital@1por1.com.ar'];

import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyA2fyVpo-4zvsMrbIO36N7enIMh9aEgetA",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "gomall-studio-v2.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "gomall-studio-v2",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "gomall-studio-v2.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "635788916794",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:635788916794:web:35ce130b8c587b352b5d03"
};

const app = !firebase.apps.length ? firebase.initializeApp(firebaseConfig) : firebase.app();
const auth = firebase.auth(app);
const db = firebase.firestore(app);
const googleProvider = new firebase.auth.GoogleAuthProvider();

export const MONTHLY_TOKEN_LIMIT = 500000; 

/** 
 * CONSTANTES DE SEGURIDAD (SAFE ZONES) ACTUALIZADAS
 * Se incrementa el margen horizontal en Story al 15% (x: 15-85) para evitar cortes en UI de Instagram.
 */
const SAFE_ZONES = {
  feed: {
    x: { min: 5, max: 95 }, 
    y: { min: 5, max: 95 }  
  },
  story: {
    x: { min: 15, max: 85 }, // Margen lateral aumentado del 10% al 15%
    y: { min: 15, max: 80 }  
  }
};

/**
 * FUNCIÓN AUXILIAR: validatePosition (Sanitize Coordinates)
 */
const validatePosition = (value: number, axis: 'x' | 'y', layout: 'feed' | 'story') => {
  const limits = SAFE_ZONES[layout][axis];
  return Math.max(limits.min, Math.min(limits.max, value));
};

googleProvider.setCustomParameters({
  prompt: 'select_account'
});

const DEFAULT_STATE: ProjectState = {
  title: 'Nuevo Proyecto',
  imageVariants: [],
  selectedVariantIndex: 0,
  feedBackgroundConfig: { scale: 1, offset: { x: 50, y: 50 } },
  storyBackgroundConfig: { scale: 1, offset: { x: 50, y: 50 } },
  logo: {
    url: null,
    size: 15,
    opacity: 100,
    feedPosition: { x: 50, y: 15 },
    storyPosition: { x: 50, y: 12 },
  },
  resource: {
    url: null,
    size: 20,
    opacity: 100,
    feedPosition: { x: 50, y: 50 },
    storyPosition: { x: 50, y: 50 },
  },
  textLayers: {
    headline: {
      content: '', font: 'Inter', size: 32, color: '#000000', backgroundColor: 'transparent', align: 'center', shadow: false, shadowColor: '#00000040', shadowBlur: 4, shadowOffset: 2, feedPosition: { x: 50, y: 42 }, storyPosition: { x: 50, y: 48 }, width: 70, bold: false, italic: false, underline: false, lineHeight: 1.2
    },
    description: {
      content: '', font: 'Inter', size: 16, color: '#000000', backgroundColor: 'transparent', align: 'center', shadow: false, shadowColor: '#00000040', shadowBlur: 3, shadowOffset: 1, feedPosition: { x: 50, y: 58 }, storyPosition: { x: 50, y: 62 }, width: 70, bold: false, italic: false, underline: false, lineHeight: 1.4
    },
    additional: {
      content: '', font: 'Inter', size: 14, color: '#000000', backgroundColor: 'transparent', align: 'center', shadow: false, shadowColor: '#00000040', shadowBlur: 3, shadowOffset: 1, feedPosition: { x: 50, y: 68 }, storyPosition: { x: 50, y: 72 }, width: 70, bold: false, italic: false, underline: false, lineHeight: 1.4
    },
    cta: {
      content: '', font: 'Inter', size: 14, color: '#FFFFFF', backgroundColor: 'transparent', align: 'center', shadow: false, shadowColor: '#00000020', shadowBlur: 4, shadowOffset: 2, feedPosition: { x: 50, y: 78 }, storyPosition: { x: 50, y: 82 }, width: 70, bold: false, italic: false, underline: false, lineHeight: 1.2
    }
  },
  feedOverlayOpacity: 0,
  storyOverlayOpacity: 0,
  backgroundOverlayColor: '#000000',
  feedShowGuides: false,
  storyShowGuides: false,
  feedShowIgOverlay: false,
  storyShowIgOverlay: false,
  selectedCopyIndex: null,
  copies: [],
  showCta: true,
  showCtaBg: true,
  ctaBgColor: '#EA5B25',
  ctaPaddingX: 32,
  ctaPaddingY: 12,
  customFonts: [],
  brandKits: [],
  logoLibrary: [],
  resourceLibrary: [],
  backgroundLibrary: [],
  extractedColors: [],
  extractedBackgroundColors: [],
  layersOrder: ['background', 'resource', 'cta', 'additional', 'description', 'headline', 'logo']
};

const App: React.FC = () => {
  const [user, setUser] = useState<firebase.User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [state, setState] = useState<ProjectState>(DEFAULT_STATE);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [githubToken, setGithubToken] = useState<string | null>(localStorage.getItem('github_token'));
  const [showAdmin, setShowAdmin] = useState(false);
  const [showCampaigns, setShowCampaigns] = useState(false);
  const [campaignInitial, setCampaignInitial] = useState<{ keyMessage?: string; dates?: string } | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showBrand, setShowBrand] = useState(false);
  const [showReels, setShowReels] = useState(false);
  const [showProductAd, setShowProductAd] = useState(false);
  const [reelCopy, setReelCopy] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GITHUB_AUTH_SUCCESS') {
        const token = event.data.token;
        setGithubToken(token);
        localStorage.setItem('github_token', token);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleGithubConnect = async () => {
    try {
      const response = await fetch('/api/auth/github/url');
      const { url } = await response.json();
      window.open(url, 'github_oauth', 'width=600,height=700');
    } catch (error) {
      console.error('Error connecting to GitHub:', error);
      alert('Error al conectar con GitHub');
    }
  };

  const handleGithubDisconnect = () => {
    setGithubToken(null);
    localStorage.removeItem('github_token');
  };
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [activeLayout, setActiveLayout] = useState<'feed' | 'story'>('feed');
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [showDrawer, setShowDrawer] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>('IMAGEN');
  const [timeUntilReset, setTimeUntilReset] = useState({ days: 0, hours: 0, mins: 0, secs: 0 });
  const [showLensMenu, setShowLensMenu] = useState(false);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  
  const [tempProfile, setTempProfile] = useState({ 
    name: '', 
    business: '', 
    mall: '',
    type: 'comercio' as 'comercio' | 'mall'
  });
  const previewSectionRef = useRef<HTMLElement>(null);
  const hasInitialProfileLoad = useRef(false);

  const currentUserLimit = profile?.tokenLimit || MONTHLY_TOKEN_LIMIT;

  const tokensPercent = profile?.usage?.tokensUsed 
    ? Math.min(100, (profile.usage.tokensUsed / currentUserLimit) * 100) 
    : 0;
  
  const isBlocked = tokensPercent >= 100 || profile?.isBlocked === true;

  useEffect(() => {
    if (!profile?.usage?.lastReset) return;

    const updateCountdown = async () => {
      const now = new Date();
      const lastResetDate = new Date(profile.usage!.lastReset);
      
      const nextResetDate = new Date(lastResetDate);
      nextResetDate.setMonth(nextResetDate.getMonth() + 1);

      const diff = nextResetDate.getTime() - now.getTime();
      
      if (diff <= 0 && user && user.uid !== 'local-test-user') {
        try {
          const cycleTokens = profile.usage?.tokensUsed || 0;
          // Guardar snapshot del ciclo antes de resetear
          await db.collection('profiles').doc(user.uid).collection('historial').add({
            tokensUsed: cycleTokens,
            costUsd: cycleTokens * 0.000005,
            cycleStart: profile.usage!.lastReset,
            cycleEnd: nextResetDate.getTime(),
            month: lastResetDate.getMonth() + 1,
            year: lastResetDate.getFullYear(),
          });
          await db.collection('profiles').doc(user.uid).update({
            'usage.tokensUsed': 0,
            'usage.lastReset': nextResetDate.getTime()
          });
        } catch (e) {
          console.error("Error al reiniciar ciclo de tokens:", e);
        }
        return;
      }

      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeUntilReset({ days: d, hours: h, mins: m, secs: s });
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [profile?.usage?.lastReset, user]);

  const formatResetTime = () => {
    return `${timeUntilReset.days}D ${String(timeUntilReset.hours).padStart(2, '0')}H`;
  };

  useEffect(() => {
    // BYPASS LOGIN FOR LOCAL TESTING
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      console.log("⚡ Bypass de login activado para desarrollo local");
      const mockUser = {
        uid: 'local-test-user',
        email: 'test@gomall.app',
        displayName: 'Local Tester',
        photoURL: 'https://ui-avatars.com/api/?name=Local+Tester'
      } as any;
      
      const mockProfile: UserProfile = {
        name: 'Tester Local',
        business: 'Mi Negocio Local',
        mall: 'Mall Test',
        type: 'comercio',
        tokenLimit: 500000,
        usage: { tokensUsed: 0, lastReset: Date.now() },
        onboardingCompleted: true,
        logoLibrary: [],
        resourceLibrary: [],
        backgroundLibrary: []
      };

      setUser(mockUser);
      setProfile(mockProfile);
      setAuthLoading(false);
      return;
    }

    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        setProfileLoading(false);
        setSavedProjects([]);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || user.uid === 'local-test-user') return;
    
    setProfileLoading(true);

    hasInitialProfileLoad.current = false;

    const unsubscribeProfile = db.collection('profiles').doc(user.uid).onSnapshot(doc => {
      if (doc.exists) {
        const data = doc.data() as UserProfile;
        setProfile(data);
        setProfileError(null);

        setState(prev => {
          // Only sync logo/resource from Firestore on the very first load.
          // On subsequent snapshots (triggered by font/color saves, library changes, etc.)
          // we keep local state to avoid a race condition where a stale Firestore value
          // overwrites a freshly-uploaded image before the DB write completes.
          const isFirstLoad = !hasInitialProfileLoad.current;
          if (isFirstLoad) hasInitialProfileLoad.current = true;

          const finalLogoUrl = isFirstLoad
            ? (data.currentLogoUrl !== undefined ? data.currentLogoUrl : prev.logo.url)
            : prev.logo.url;
          const finalResourceUrl = isFirstLoad
            ? (data.currentResourceUrl !== undefined ? data.currentResourceUrl : prev.resource.url)
            : prev.resource.url;

          // Register @font-face for custom fonts from profile
          (data.customFonts || []).forEach((font: CustomFont) => {
            if (!font.url || !font.family) return;
            const styleId = `custom-font-${font.family}`;
            if (!document.getElementById(styleId)) {
              const style = document.createElement('style');
              style.id = styleId;
              style.textContent = `@font-face { font-family: '${font.family}'; src: url('${font.url}'); }`;
              document.head.appendChild(style);
            }
          });

          return {
            ...prev,
            logo: { ...prev.logo, url: finalLogoUrl || null },
            resource: { ...prev.resource, url: finalResourceUrl || null },
            logoLibrary: data.logoLibrary || prev.logoLibrary,
            resourceLibrary: data.resourceLibrary || prev.resourceLibrary,
            backgroundLibrary: data.backgroundLibrary || prev.backgroundLibrary,
            customFonts: data.customFonts || prev.customFonts,
            brandKits: data.brandKits || prev.brandKits,
            textLayers: {
              headline: { ...prev.textLayers.headline, font: data.lastUsedFonts?.headline || prev.textLayers.headline.font, color: data.lastUsedColors?.headline || prev.textLayers.headline.color },
              description: { ...prev.textLayers.description, font: data.lastUsedFonts?.description || prev.textLayers.description.font, color: data.lastUsedColors?.description || prev.textLayers.description.color },
              additional: { ...prev.textLayers.additional, font: data.lastUsedFonts?.additional || prev.textLayers.additional.font, color: data.lastUsedColors?.additional || prev.textLayers.additional.color },
              cta: { ...prev.textLayers.cta, font: data.lastUsedFonts?.cta || prev.textLayers.cta.font, color: data.lastUsedColors?.cta || prev.textLayers.cta.color }
            },
            ctaBgColor: data.lastUsedColors?.ctaBg || prev.ctaBgColor
          };
        });
      } else {
        setProfile(null);
        setProfileError(null);
      }
      setProfileLoading(false);
    }, (error) => {
      console.error("Firestore Snapshot Error:", error);
      setProfileError(error.message);
      setProfileLoading(false);
    });

    const unsubscribeProjects = db.collection('usuarios')
      .doc(user.uid)
      .collection('disenos')
      .onSnapshot(snapshot => {
        const projects = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as SavedProject[];
        
        // Ordenamos en el cliente para evitar el error de "Missing Index" en Firestore
        projects.sort((a, b) => {
          const timeA = a.updatedAt?.toMillis?.() || a.updatedAt?.seconds || 0;
          const timeB = b.updatedAt?.toMillis?.() || b.updatedAt?.seconds || 0;
          return timeB - timeA;
        });
        
        setSavedProjects(projects);
      }, (error) => {
        console.error("Firestore Projects Snapshot Error:", error);
      });

    return () => {
      unsubscribeProfile();
      unsubscribeProjects();
    };
  }, [user]);

  useEffect(() => {
    if (!user || profileLoading || isBlocked || !profile) return;
    
    const updatePrefs = async () => {
      try {
        await db.collection('profiles').doc(user.uid).update({
          lastUsedFonts: {
            headline: state.textLayers.headline.font,
            description: state.textLayers.description.font,
            additional: state.textLayers.additional.font,
            cta: state.textLayers.cta.font
          },
          lastUsedColors: {
            headline: state.textLayers.headline.color,
            description: state.textLayers.description.color,
            additional: state.textLayers.additional.color,
            cta: state.textLayers.cta.color,
            ctaBg: state.ctaBgColor
          }
        });
      } catch (e) {
        console.error("Error al persistir preferencias:", e);
      }
    };

    const timer = setTimeout(updatePrefs, 3000); 
    return () => clearTimeout(timer);
  }, [
    state.textLayers.headline.font, state.textLayers.headline.color,
    state.textLayers.description.font, state.textLayers.description.color,
    state.textLayers.additional.font, state.textLayers.additional.color,
    state.textLayers.cta.font, state.textLayers.cta.color,
    state.ctaBgColor, user, isBlocked, profile
  ]);

  const handleLogin = async () => {
    try {
      await auth.signInWithPopup(googleProvider);
    } catch (e: any) {
      const code = e?.code || '';
      // Mensajes claros segun el motivo real del fallo
      if (code === 'auth/unauthorized-domain') {
        alert("Este dominio no está autorizado en Firebase.\n\nAgregá tu dominio en: Firebase Console → Authentication → Settings → Authorized domains.");
      } else if (code === 'auth/operation-not-allowed') {
        alert("El proveedor de Google no está habilitado.\n\nActivalo en: Firebase Console → Authentication → Sign-in method → Google.");
      } else if (code === 'auth/invalid-api-key' || code === 'auth/api-key-not-valid' || code === 'auth/api-key-not-valid.-please-pass-a-valid-api-key.') {
        alert("La API key de Firebase no es válida o no se cargó en el build. Revisá las variables VITE_FIREBASE_* en Hostinger y volvé a hacer deploy.");
      } else if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request' || code === 'auth/popup-closed-by-user') {
        // El navegador bloqueó el popup → reintentar con redirección
        try { await auth.signInWithRedirect(googleProvider); return; } catch {}
        alert("El navegador bloqueó la ventana de Google. Permití los popups e intentá de nuevo.");
      } else {
        alert(`Error al iniciar sesión con Google: ${code || e?.message || 'desconocido'}`);
      }
      console.error("Login error:", code, e?.message);
    }
  };

  const handleLogout = async () => {
    try { 
      setUser(null);
      setProfile(null);
      setState(DEFAULT_STATE);
      setTempProfile({ name: '', business: '', mall: '', type: 'comercio' });
      setProfileLoading(false);
      setIsSaving(false);
      setTimeUntilReset({ days: 0, hours: 0, mins: 0, secs: 0 });
      setSelectedField(null);
      setShowDrawer(false);
      
      await auth.signOut(); 
    } catch (e) { 
      console.error("Error en Logout:", e); 
    }
  };

  const saveProfile = async () => {
    const isComercio = tempProfile.type === 'comercio';
    const isValid = isComercio 
      ? (tempProfile.name && tempProfile.business && tempProfile.mall)
      : (tempProfile.name && tempProfile.mall);

    if (user && isValid) {
      setIsSaving(true);
      try {
        const initialUsage = { tokensUsed: 0, lastReset: Date.now() };
        const tokenLimit = isComercio ? 1000000 : 2000000;

        await db.collection('profiles').doc(user.uid).set({
          name: tempProfile.name,
          business: isComercio ? tempProfile.business : (tempProfile.mall || 'Administración'),
          mall: tempProfile.mall,
          type: tempProfile.type,
          email: user.email,
          usage: initialUsage,
          tokenLimit: tokenLimit,
          logoLibrary: [],
          resourceLibrary: [],
          backgroundLibrary: [],
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (e) {
        alert("Hubo un problema al guardar tu perfil.");
      } finally {
        setIsSaving(false);
      }
    } else {
      alert("Por favor, completa todos los campos.");
    }
  };

  const updateUsage = async (tokens: number) => {
    if (!user || !profile) return;
    
    try {
      const currentTokens = profile.usage?.tokensUsed || 0;
      const newTotal = currentTokens + tokens;
      const currentLimit = profile.tokenLimit || MONTHLY_TOKEN_LIMIT;
      
      if (newTotal >= currentLimit && currentTokens < currentLimit) {
        await db.collection('alerts').add({
          type: 'LIMIT_REACHED',
          userId: user.uid,
          business: profile.business,
          mall: profile.mall,
          email: user.email,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      await db.collection('profiles').doc(user.uid).update({
        'usage.tokensUsed': newTotal,
        'usage.lastUsed': Date.now()
      });
    } catch (e) {
      console.error("Error updating usage:", e);
    }
  };

  const updateState = useCallback((updates: Partial<ProjectState>) => {
    if (isBlocked) return;
    setState(prev => ({ ...prev, ...updates }));
  }, [isBlocked]);

  // Plantillas de auto-diseño: reordena las capas de texto en layouts profesionales
  // y aplica las fuentes/colores de la marca, sin que el usuario tenga que ajustar nada.
  const applyTemplate = (type: 'classic' | 'editorial' | 'bold' | 'minimal') => {
    if (isBlocked) return;
    const kit = profile?.brandKits?.[0];
    const layouts: Record<string, any> = {
      classic: {
        overlay: 25,
        headline:    { align: 'center', size: 34, feed: { x: 50, y: 40 }, story: { x: 50, y: 44 } },
        description: { align: 'center', size: 17, feed: { x: 50, y: 55 }, story: { x: 50, y: 56 } },
        additional:  { align: 'center', size: 14, feed: { x: 50, y: 64 }, story: { x: 50, y: 64 } },
        cta:         { align: 'center', size: 14, feed: { x: 50, y: 80 }, story: { x: 50, y: 78 } },
      },
      editorial: {
        overlay: 32,
        headline:    { align: 'left', size: 30, feed: { x: 32, y: 58 }, story: { x: 34, y: 56 } },
        description: { align: 'left', size: 15, feed: { x: 32, y: 70 }, story: { x: 34, y: 66 } },
        additional:  { align: 'left', size: 13, feed: { x: 32, y: 78 }, story: { x: 34, y: 73 } },
        cta:         { align: 'left', size: 13, feed: { x: 28, y: 87 }, story: { x: 30, y: 80 } },
      },
      bold: {
        overlay: 45,
        headline:    { align: 'center', size: 46, feed: { x: 50, y: 44 }, story: { x: 50, y: 46 } },
        description: { align: 'center', size: 18, feed: { x: 50, y: 62 }, story: { x: 50, y: 62 } },
        additional:  { align: 'center', size: 14, feed: { x: 50, y: 70 }, story: { x: 50, y: 70 } },
        cta:         { align: 'center', size: 15, feed: { x: 50, y: 82 }, story: { x: 50, y: 79 } },
      },
      minimal: {
        overlay: 12,
        headline:    { align: 'center', size: 24, feed: { x: 50, y: 76 }, story: { x: 50, y: 73 } },
        description: { align: 'center', size: 14, feed: { x: 50, y: 84 }, story: { x: 50, y: 79 } },
        additional:  { align: 'center', size: 12, feed: { x: 50, y: 89 }, story: { x: 50, y: 84 } },
        cta:         { align: 'center', size: 13, feed: { x: 50, y: 92 }, story: { x: 50, y: 88 } },
      },
    };
    const cfg = layouts[type];
    const fontFor: Record<string, string | undefined> = { headline: kit?.headlineFont, description: kit?.descriptionFont, additional: kit?.additionalFont, cta: kit?.ctaFont };
    const colorFor: Record<string, string | undefined> = { headline: kit?.headlineColor, description: kit?.descriptionColor, additional: kit?.additionalColor, cta: kit?.ctaColor };
    setState(prev => {
      const build = (key: 'headline' | 'description' | 'additional' | 'cta') => {
        const l = prev.textLayers[key];
        const c = cfg[key];
        return { ...l, align: c.align, size: c.size, feedPosition: c.feed, storyPosition: c.story, font: fontFor[key] || l.font, color: colorFor[key] || l.color };
      };
      return {
        ...prev,
        feedOverlayOpacity: cfg.overlay,
        storyOverlayOpacity: cfg.overlay,
        backgroundOverlayColor: kit?.overlayColor ?? prev.backgroundOverlayColor,
        textLayers: { headline: build('headline'), description: build('description'), additional: build('additional'), cta: build('cta') },
      };
    });
  };

  const handleProductAd = (imageUrl: string, prompt: string) => {
    const kit = profile?.brandKits?.[0];
    setState(prev => ({
      ...prev,
      imageVariants: [{ id: String(Date.now()), url: imageUrl, prompt }, ...prev.imageVariants],
      selectedVariantIndex: 0,
      logo: kit?.logoUrls?.[0] ? { ...prev.logo, url: kit.logoUrls[0] } : prev.logo,
    }));
    setShowProductAd(false);
    setActiveTab('editor');
    setOpenSection('IMAGEN');
  };

  const handleUsePiece = (piece: CampaignPiece) => {
    // Las piezas de reel van al editor de video
    if (piece.type === 'reel') {
      setReelCopy(piece.copy || null);
      setShowCampaigns(false);
      setShowReels(true);
      return;
    }
    // Identidad de marca definida en el onboarding (primer kit) → se aplica sola para mantener coherencia
    const kit = profile?.brandKits?.[0];
    setState(prev => {
      const newCopies = piece.copy ? [...prev.copies, piece.copy] : prev.copies;
      const layers = { ...prev.textLayers };
      layers.headline = { ...layers.headline, content: piece.title || layers.headline.content };
      if (kit) {
        layers.headline = { ...layers.headline, font: kit.headlineFont || layers.headline.font, color: kit.headlineColor || layers.headline.color };
        layers.description = { ...layers.description, font: kit.descriptionFont || layers.description.font, color: kit.descriptionColor || layers.description.color };
        layers.additional = { ...layers.additional, font: kit.additionalFont || layers.additional.font, color: kit.additionalColor || layers.additional.color };
        layers.cta = { ...layers.cta, font: kit.ctaFont || layers.cta.font, color: kit.ctaColor || layers.cta.color };
      }
      return {
        ...prev,
        copies: newCopies,
        selectedCopyIndex: piece.copy ? newCopies.length - 1 : prev.selectedCopyIndex,
        logo: kit?.logoUrls?.[0] ? { ...prev.logo, url: kit.logoUrls[0] } : prev.logo,
        resource: kit?.resourceUrls?.[0] ? { ...prev.resource, url: kit.resourceUrls[0] } : prev.resource,
        backgroundOverlayColor: kit?.overlayColor ?? prev.backgroundOverlayColor,
        ctaBgColor: kit?.ctaBgColor ?? prev.ctaBgColor,
        textLayers: layers,
      };
    });
    // Dispara la generación automática de la imagen con el prompt sugerido por la campaña
    setPendingPrompt(piece.imagePrompt || '');
    setShowCampaigns(false);
    setActiveTab('editor');
    setOpenSection('IMAGEN');
  };

  const handleLayerAction = (layerName: string, action: 'front' | 'up' | 'down') => {
    if (isBlocked) return;
    setState(prev => {
      const newOrder = [...prev.layersOrder];
      const idx = newOrder.indexOf(layerName);
      if (idx === -1) return prev;

      if (action === 'front') {
        newOrder.splice(idx, 1);
        newOrder.push(layerName);
      } else if (action === 'up' && idx < newOrder.length - 1) {
        const temp = newOrder[idx];
        newOrder[idx] = newOrder[idx + 1];
        newOrder[idx + 1] = temp;
      } else if (action === 'down' && idx > 0) {
        const temp = newOrder[idx];
        newOrder[idx] = newOrder[idx - 1];
        newOrder[idx - 1] = temp;
      }

      return { ...prev, layersOrder: newOrder };
    });
  };

  const onUpdateText = (key: 'headline' | 'description' | 'additional' | 'cta', updates: any, layout: 'feed' | 'story') => {
    if (isBlocked) return;
    setState(prev => {
      const layer = prev.textLayers[key];
      const posKey = layout === 'feed' ? 'feedPosition' : 'storyPosition';
      const updatedLayer = { ...layer, ...updates };
      if (updates.position) {
        (updatedLayer as any)[posKey] = {
          x: validatePosition(updates.position.x, 'x', layout),
          y: validatePosition(updates.position.y, 'y', layout)
        };
        delete (updatedLayer as any).position;
      }
      return { ...prev, textLayers: { ...prev.textLayers, [key]: updatedLayer } };
    });
  };

  const onUpdateLogo = (updates: any, layout: 'feed' | 'story') => {
    if (isBlocked) return;
    setState(prev => {
      const posKey = layout === 'feed' ? 'feedPosition' : 'storyPosition';
      const newLogo = { ...prev.logo, ...updates };
      if (updates.position) {
        (newLogo as any)[posKey] = {
          x: validatePosition(updates.position.x, 'x', layout),
          y: validatePosition(updates.position.y, 'y', layout)
        };
        delete (newLogo as any).position;
      }
      return { ...prev, logo: newLogo };
    });
  };

  const onUpdateResource = (updates: any, layout: 'feed' | 'story') => {
    if (isBlocked) return;
    setState(prev => {
      const posKey = layout === 'feed' ? 'feedPosition' : 'storyPosition';
      const newResource = { ...prev.resource, ...updates };
      if (updates.position) {
        (newResource as any)[posKey] = {
          x: validatePosition(updates.position.x, 'x', layout),
          y: validatePosition(updates.position.y, 'y', layout)
        };
        delete (newResource as any).position;
      }
      return { ...prev, resource: newResource };
    });
  };

  const onSelectLayer = (key: string, layout: 'feed' | 'story') => {
    if (isBlocked) return;
    setSelectedField(key);
    setActiveLayout(layout);
    
    if (key && key !== 'background' && key !== 'image') {
      setState(prev => ({
        ...prev,
        layersOrder: [...prev.layersOrder.filter(item => item !== key), key]
      }));
    }

    if (window.innerWidth < 768) {
      setShowDrawer(true);
      setShowLensMenu(false);
      
      setTimeout(() => {
        if (previewSectionRef.current) {
          const canvasId = layout === 'story' ? 'story-canvas' : 'feed-canvas';
          const canvas = document.getElementById(canvasId);
          if (canvas) {
            const canvasRect = canvas.getBoundingClientRect();
            let relY = 50;
            if (['headline', 'description', 'additional', 'cta'].includes(key)) {
              const layer = state.textLayers[key as keyof typeof state.textLayers];
              relY = layout === 'story' ? layer.storyPosition.y : layer.feedPosition.y;
            } else if (key === 'logo') {
              relY = layout === 'story' ? state.logo.storyPosition.y : state.logo.feedPosition.y;
            } else if (key === 'resource') {
              relY = layout === 'story' ? state.resource.storyPosition.y : state.resource.feedPosition.y;
            }
            
            const absoluteElementY = window.pageYOffset + canvasRect.top + (canvasRect.height * (relY / 100));
            const targetScrollY = absoluteElementY - (window.innerHeight * 0.3);
            
            window.scrollTo({
              top: targetScrollY,
              behavior: 'smooth'
            });

            const containerRelativeY = canvasRect.top + (canvasRect.height * (relY / 100)) - (window.innerHeight * 0.3);
            previewSectionRef.current.scrollBy({
              top: containerRelativeY,
              behavior: 'smooth'
            });
          }
        }
      }, 150);
    } else {
      if (['headline', 'description', 'additional', 'cta'].includes(key)) {
        setOpenSection('TEXTOS');
      } else if (key === 'logo') setOpenSection('MARCA');
      else if (key === 'resource') setOpenSection('RECURSOS');
      else if (key === 'background' || key === 'image') setOpenSection('IMAGEN');
    }
  };

  /**
   * BLOQUE DE PROCESAMIENTO DE DISEÑO (ESTILO / IA)
   */
  const applyDesignStyle = (styleType: 'bold' | 'elegant' | 'modern' | 'clean') => {
    if (isBlocked) return;
    
    const palette = state.extractedColors.length > 0 ? state.extractedColors : ['#000000', '#EA5B25', '#FFFFFF'];
    const accent = palette.includes('#EA5B25') ? '#EA5B25' : (palette[0] || '#EA5B25');
    
    // Posiciones sugeridas base (serán saneadas por validatePosition)
    const SUGGESTED_POS = { LOGO: 15, HEADLINE: 38, DESCRIPTION: 58, CTA: 82 };

    const styles: Record<string, any> = {
      bold: {
        headline: { font: 'Bebas Neue', size: 48, bold: true, align: 'center', color: accent, y: SUGGESTED_POS.HEADLINE },
        description: { font: 'Montserrat', size: 16, bold: true, align: 'center', color: '#1A1A1A', y: SUGGESTED_POS.DESCRIPTION },
        cta: { font: 'Montserrat', size: 14, bold: true, color: '#FFFFFF', bgColor: accent, y: SUGGESTED_POS.CTA }
      },
      elegant: {
        headline: { font: 'Playfair Display', size: 36, bold: false, italic: true, align: 'center', color: palette[0], y: SUGGESTED_POS.HEADLINE },
        description: { font: 'Lora', size: 15, bold: false, align: 'center', color: palette[0], y: SUGGESTED_POS.DESCRIPTION },
        cta: { font: 'Inter', size: 12, bold: false, color: '#FFFFFF', bgColor: palette[0], y: SUGGESTED_POS.CTA }
      },
      modern: {
        headline: { font: 'Montserrat', size: 32, bold: true, align: 'left', color: '#000000', y: SUGGESTED_POS.HEADLINE },
        description: { font: 'Inter', size: 14, bold: false, align: 'left', color: '#444444', y: SUGGESTED_POS.DESCRIPTION },
        cta: { font: 'Inter', size: 13, bold: true, color: '#FFFFFF', bgColor: accent, y: SUGGESTED_POS.CTA }
      },
      clean: {
        headline: { font: 'Inter', size: 28, bold: false, align: 'center', color: '#000000', y: SUGGESTED_POS.HEADLINE },
        description: { font: 'Inter', size: 14, bold: false, align: 'center', color: '#666666', y: SUGGESTED_POS.DESCRIPTION },
        cta: { font: 'Inter', size: 12, bold: false, color: '#FFFFFF', bgColor: '#000000', y: SUGGESTED_POS.CTA }
      }
    };

    const s = styles[styleType];
    
    updateState({
      logo: { 
        ...state.logo, 
        feedPosition: { 
          x: validatePosition(50, 'x', 'feed'), 
          y: validatePosition(SUGGESTED_POS.LOGO, 'y', 'feed') 
        }, 
        storyPosition: { 
          x: validatePosition(50, 'x', 'story'), 
          y: validatePosition(SUGGESTED_POS.LOGO, 'y', 'story') 
        } 
      },
      textLayers: {
        ...state.textLayers,
        headline: { 
          ...state.textLayers.headline, 
          ...s.headline, 
          feedPosition: { 
            x: validatePosition(s.headline.align === 'left' ? 15 : 50, 'x', 'feed'), 
            y: validatePosition(s.headline.y, 'y', 'feed') 
          },
          storyPosition: { 
            x: validatePosition(s.headline.align === 'left' ? 15 : 50, 'x', 'story'), 
            y: validatePosition(s.headline.y, 'y', 'story') 
          }
        },
        description: { 
          ...state.textLayers.description, 
          ...s.description,
          feedPosition: { 
            x: validatePosition(s.description.align === 'left' ? 15 : 50, 'x', 'feed'), 
            y: validatePosition(s.description.y, 'y', 'feed') 
          },
          storyPosition: { 
            x: validatePosition(s.description.align === 'left' ? 15 : 50, 'x', 'story'), 
            y: validatePosition(s.description.y, 'y', 'story') 
          }
        },
        cta: { 
          ...state.textLayers.cta, 
          ...s.cta,
          feedPosition: { 
            x: validatePosition(50, 'x', 'feed'), 
            y: validatePosition(s.cta.y, 'y', 'feed') 
          },
          storyPosition: { 
            x: validatePosition(50, 'x', 'story'), 
            y: validatePosition(s.cta.y, 'y', 'story') 
          }
        }
      },
      ctaBgColor: s.cta.bgColor
    });
  };

  const exportLayout = async (canvasId: string, fileName: string) => {
    if (isBlocked) return;
    const element = document.getElementById(canvasId);
    if (!element || exportingId) return;
    
    setExportingId(canvasId);
    element.classList.add('is-exporting-container');
    
    try {
      await new Promise(resolve => setTimeout(resolve, 600));
      const isMobile = window.innerWidth < 768;
      
      const options = {
        pixelRatio: isMobile ? 3 : 4,
        backgroundColor: '#ffffff',
        cacheBust: true,
        style: {
          border: 'none', boxShadow: 'none', margin: '0', padding: '0', borderRadius: '0', top: '0', left: '0', outline: 'none', webkitFontSmoothing: 'antialiased', mozOsxFontSmoothing: 'grayscale'
        },
        filter: (node: any) => {
          if (node.classList) {
            if (node.classList.contains('nav-variant-btn')) return false;
            if (node.classList.contains('floating-controls')) return false;
            if (node.classList.contains('safe-zone-overlay')) return false;
            if (node.classList.contains('no-export')) return false;
          }
          if (node.tagName === 'BUTTON') return false;
          return true;
        }
      };

      // Workaround for Safari: call once to load images
      await htmlToImage.toBlob(element, options);
      const blob = await htmlToImage.toBlob(element, options);
      
      if (!blob) throw new Error('Failed to create blob');

      if (isMobile && navigator.share) {
        try {
          const file = new File([blob], fileName, { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Gomall Studio Export' });
            return;
          }
        } catch (e) {
          console.error("Share failed:", e);
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = fileName; 
      link.href = url;
      document.body.appendChild(link); 
      link.click(); 
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error(err);
      alert('Error al generar la imagen.');
    } finally {
      element.classList.remove('is-exporting-container');
      setExportingId(null);
    }
  };

  const compressBase64Image = async (base64Str: string, maxWidth: number = 800, quality: number = 0.6, preserveAlpha: boolean = false): Promise<string> => {
    if (!base64Str || !base64Str.startsWith('data:image')) return base64Str;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(preserveAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(base64Str);
        }
      };
      img.onerror = () => resolve(base64Str);
      img.src = base64Str;
    });
  };

  const saveProject = async (canvasId: string) => {
    if (!user || isBlocked) return;
    const element = document.getElementById(canvasId);
    if (!element) return;

    try {
      // Usamos toJpeg con baja calidad y pixelRatio reducido para que la miniatura
      const options = {
        quality: 0.4,
        pixelRatio: 0.5,
        backgroundColor: '#ffffff',
        cacheBust: true,
        filter: (node: any) => {
          if (node.classList) {
            if (node.classList.contains('nav-variant-btn')) return false;
            if (node.classList.contains('floating-controls')) return false;
            if (node.classList.contains('safe-zone-overlay')) return false;
            if (node.classList.contains('no-export')) return false;
          }
          if (node.tagName === 'BUTTON') return false;
          return true;
        }
      };

      // Workaround for Safari: call once to load images
      await htmlToImage.toJpeg(element, options);
      const thumbnailDataUrl = await htmlToImage.toJpeg(element, options);
      
      if (!thumbnailDataUrl) throw new Error('Failed to create thumbnail');

      // 2. Ruta estructurada: usuarios/{uid}/disenos/{disenoId}
      const disenosRef = db.collection('usuarios').doc(user.uid).collection('disenos');
      const nuevoDisenoRef = disenosRef.doc(); // Genera un ID único automáticamente

      // Limpieza profunda del estado para evitar el límite de 1MB de Firestore
      const stateToSave = { ...state };
      
      // 1. Eliminamos el historial de IA (imágenes base64 pesadas), PERO conservamos la imagen seleccionada
      if (state.imageVariants && state.imageVariants.length > 0 && state.selectedVariantIndex !== undefined) {
        const selectedVariant = { ...state.imageVariants[state.selectedVariantIndex] };
        if (selectedVariant && selectedVariant.url) {
          // Comprimimos fuertemente la imagen de fondo generada
          selectedVariant.url = await compressBase64Image(selectedVariant.url, 1080, 0.7);
          stateToSave.imageVariants = [selectedVariant];
          stateToSave.selectedVariantIndex = 0;
        } else {
          stateToSave.imageVariants = [];
        }
      } else {
        stateToSave.imageVariants = []; 
      }
      
      // Comprimimos logo y recurso si existen en el estado guardado
      if (stateToSave.logo?.url) {
        stateToSave.logo = { ...stateToSave.logo, url: await compressBase64Image(stateToSave.logo.url, 400, 0.6, true) };
      }
      if (stateToSave.resource?.url) {
        stateToSave.resource = { ...stateToSave.resource, url: await compressBase64Image(stateToSave.resource.url, 800, 0.6, true) };
      }
      
      // 2. Eliminamos las librerías del usuario (ya están en su perfil)
      stateToSave.logoLibrary = [];
      stateToSave.backgroundLibrary = [];
      stateToSave.resourceLibrary = [];
      
      const stateString = JSON.stringify(stateToSave);

      // 3. Guardado en base de datos
      await nuevoDisenoRef.set({
        userId: user.uid,
        state: stateString,
        thumbnail: thumbnailDataUrl,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      console.log("Diseño guardado exitosamente con ID:", nuevoDisenoRef.id);
      alert('Proyecto guardado exitosamente en tu galería.');
    } catch (error: any) {
      // 4. Captura e identificación específica de errores
      console.error('Error al guardar proyecto:', error);
      
      if (error.code === 'permission-denied') {
        alert("Error de permisos: Verifica las reglas de Firestore.");
      } else if (error.code === 'unavailable') {
        alert("Error de conexión: Parece que tu red o la red de AI Studio está bloqueando Firebase.");
      } else if (error.code === 'invalid-argument') {
        alert("Error de datos: Estás intentando guardar un archivo demasiado pesado (límite 1MB) o con un formato inválido.");
      } else {
        alert(`Error al guardar: ${error.message || 'Error desconocido'}`);
      }
    }
  };

  if (authLoading || (user && profileLoading)) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-white">
        <div className="w-12 h-12 border-4 border-slate-100 border-t-[#EA5B25] rounded-full animate-spin mb-4"></div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Iniciando Gomall...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#F8F9FA] p-6 relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] aspect-square bg-orange-100/30 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] aspect-square bg-blue-100/30 rounded-full blur-[120px]"></div>
        <div className="max-w-md w-full text-center space-y-10 z-10 animate-in fade-in zoom-in-95 duration-700">
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 bg-[#EA5B25] rounded-[32px] flex items-center justify-center text-white shadow-2xl shadow-orange-200">
              <i className="fa-solid fa-wand-magic-sparkles text-3xl"></i>
            </div>
            <div className="flex flex-col">
              <h1 className="text-3xl font-[900] uppercase tracking-[0.2em] text-slate-900 leading-none">GOMALL</h1>
              <span className="text-[12px] font-black uppercase tracking-[0.4em] text-[#EA5B25] mt-2">STUDIO</span>
            </div>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-slate-800">Crea contenido publicitario con IA</h2>
            <p className="text-slate-400 text-sm leading-relaxed">Accede a la herramienta exclusiva para socios de Gomall y potencia la imagen de tu negocio.</p>
          </div>
          <button onClick={handleLogin} className="w-full h-16 bg-white border border-slate-200 rounded-2xl flex items-center justify-center gap-4 shadow-xl hover:shadow-2xl hover:border-orange-100 transition-all active:scale-95 group">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
            <span className="text-sm font-bold text-slate-700">Continuar con Google</span>
          </button>
        </div>
      </div>
    );
  }

  if (user && profileError) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#F8F9FA] p-6">
        <div className="max-w-md w-full bg-white rounded-[40px] p-10 shadow-xl border border-slate-50 space-y-6 text-center">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4"><i className="fa-solid fa-triangle-exclamation text-2xl"></i></div>
          <h2 className="text-xl font-black text-slate-900">Error de Permisos</h2>
          <p className="text-slate-500 text-sm">No pudimos cargar tu perfil. Es muy probable que las reglas de Firebase Firestore se hayan sobreescrito incorrectamente.</p>
          <div className="p-4 bg-slate-50 rounded-xl text-left overflow-auto">
            <code className="text-[10px] text-slate-600 font-mono">{profileError}</code>
          </div>
          <button onClick={() => auth.signOut()} className="w-full py-4 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-200 transition-all">Cerrar Sesión</button>
        </div>
      </div>
    );
  }

  if (user && !profileLoading && (!profile || !profile.onboardingCompleted)) {
    return (
      <BrandOnboarding
        user={user}
        compressBase64Image={compressBase64Image}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#F8F9FA] overflow-hidden relative">
      {showAdmin && <AdminDashboard onClose={() => setShowAdmin(false)} />}
      {showCampaigns && user && (
        <CampaignStudio
          profile={profile}
          userId={user.uid}
          onClose={() => { setShowCampaigns(false); setCampaignInitial(null); }}
          updateUsage={updateUsage}
          onUsePiece={handleUsePiece}
          initialBrief={campaignInitial}
        />
      )}
      {showCalendar && user && (
        <CalendarStudio
          profile={profile}
          userId={user.uid}
          onClose={() => setShowCalendar(false)}
          onCreateCampaign={(prefill) => { setCampaignInitial(prefill); setShowCalendar(false); setShowCampaigns(true); }}
        />
      )}
      {showProductAd && (
        <ProductAdStudio
          profile={profile}
          onClose={() => setShowProductAd(false)}
          updateUsage={updateUsage}
          onUseImage={handleProductAd}
          compressBase64Image={compressBase64Image}
        />
      )}
      {showReels && (
        <ReelStudio
          profile={profile}
          onClose={() => setShowReels(false)}
          initialCopy={reelCopy}
        />
      )}
      {showBrand && user && (
        <BrandSettings
          profile={profile}
          userId={user.uid}
          onClose={() => setShowBrand(false)}
          compressBase64Image={compressBase64Image}
        />
      )}
      
      {isBlocked && (
        <div className="absolute inset-0 z-[100] bg-white/60 backdrop-blur-xl flex items-center justify-center p-6 text-center animate-in fade-in duration-500">
          <div className="max-w-lg w-full space-y-12">
            <div className="space-y-4">
               <div className="w-24 h-24 bg-orange-50 text-[#EA5B25] rounded-[40px] flex items-center justify-center mx-auto shadow-2xl shadow-orange-100 animate-bounce"><i className="fa-solid fa-triangle-exclamation text-4xl"></i></div>
               <h2 className="text-3xl font-[900] text-slate-900 uppercase tracking-tight leading-tight">
                 {profile?.isBlocked ? (
                   <>Cuenta<br/><span className="text-[#EA5B25]">Suspendida</span></>
                 ) : (
                   <>Has alcanzado tu<br/><span className="text-[#EA5B25]">límite de tokens</span></>
                 )}
               </h2>
               <p className="text-slate-500 text-sm font-medium leading-relaxed px-10">
                 {profile?.isBlocked 
                   ? "Tu cuenta ha sido suspendida administrativamente. Por favor, contacta con soporte para más información."
                   : "Tu cuota mensual de generación con IA se ha completado. Podrás seguir creando contenido cuando se reinicie tu ciclo de tokens."}
               </p>
            </div>
            {!profile?.isBlocked && (
              <div className="grid grid-cols-4 gap-3 md:gap-4">
                <div className="bg-white border border-slate-100 rounded-[24px] p-4 shadow-sm"><span className="block text-2xl font-black text-slate-900 tabular-nums">{timeUntilReset.days}</span><span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Días</span></div>
                <div className="bg-white border border-slate-100 rounded-[24px] p-4 shadow-sm"><span className="block text-2xl font-black text-slate-900 tabular-nums">{timeUntilReset.hours}</span><span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Horas</span></div>
                <div className="bg-white border border-slate-100 rounded-[24px] p-4 shadow-sm"><span className="block text-2xl font-black text-slate-900 tabular-nums">{timeUntilReset.mins}</span><span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Mins</span></div>
                <div className="bg-white border border-slate-100 rounded-[24px] p-4 shadow-sm"><span className="block text-2xl font-black text-slate-900 tabular-nums">{timeUntilReset.secs}</span><span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Segs</span></div>
              </div>
            )}
            <button onClick={handleLogout} className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] hover:text-[#EA5B25] transition-colors">Cerrar Sesión</button>
          </div>
        </div>
      )}

      <header className="h-20 sm:h-24 bg-white/90 backdrop-blur-xl border-b border-slate-100 flex items-center justify-between gap-3 px-4 sm:px-6 shrink-0 z-30">
        {/* Marca */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-[#EA5B25] to-[#f0814f] text-white flex items-center justify-center shadow-lg shadow-orange-200/40 shrink-0">
            <i className="fa-solid fa-wand-magic-sparkles text-sm sm:text-base"></i>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-xl text-[#0F172A] leading-tight truncate">{user?.email && ADMIN_EMAILS.includes(user.email) ? 'Administrador' : (profile?.business || 'Negocio')}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 truncate max-w-[120px] sm:max-w-[180px]">{user?.email && ADMIN_EMAILS.includes(user.email) ? 'GOMALL STUDIO' : (profile?.industry || 'GOMALL STUDIO')}</span>
              <span className="text-slate-200 text-[8px] hidden sm:inline">•</span>
              <span className="text-[8px] sm:text-[9px] font-black text-[#EA5B25] uppercase tracking-tight whitespace-nowrap">{Math.round(tokensPercent)}% USADO</span>
              <span className="text-[8px] sm:text-[9px] font-black text-slate-400 uppercase tracking-tight whitespace-nowrap hidden md:flex items-center gap-1">· Renueva <span className="text-slate-600">{formatResetTime()}</span></span>
            </div>
          </div>
        </div>
        {/* Acciones */}
        <div className="flex justify-end items-center gap-1.5 sm:gap-2 shrink-0">
          <button onClick={() => setShowBrand(true)} title="Mi Marca" className="h-10 w-10 lg:w-auto lg:px-4 flex items-center justify-center gap-2 bg-white text-slate-600 border border-slate-200 rounded-xl transition-all shadow-sm shadow-slate-200/50 active:scale-95 hover:border-orange-200 hover:text-[#EA5B25]">
            <i className="fa-solid fa-gem text-base"></i>
            <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest">Marca</span>
          </button>
          <button onClick={() => setShowCalendar(true)} title="Calendario" className="h-10 w-10 lg:w-auto lg:px-4 flex items-center justify-center gap-2 bg-white text-slate-600 border border-slate-200 rounded-xl transition-all shadow-sm shadow-slate-200/50 active:scale-95 hover:border-sky-200 hover:text-sky-600">
            <i className="fa-solid fa-calendar-days text-base"></i>
            <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest">Calendario</span>
          </button>
          <button onClick={() => { setCampaignInitial(null); setShowCampaigns(true); }} title="Campañas IA" className="h-10 w-10 lg:w-auto lg:px-4 flex items-center justify-center gap-2 bg-gradient-to-r from-[#EA5B25] to-[#f0814f] text-white rounded-xl transition-all shadow-md shadow-orange-200/50 active:scale-95 hover:shadow-lg hover:shadow-orange-200/60">
            <i className="fa-solid fa-bullhorn text-base"></i>
            <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest">Campañas</span>
          </button>
          <button onClick={() => { setReelCopy(null); setShowReels(true); }} title="Editor de Reels" className="h-10 w-10 lg:w-auto lg:px-4 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-violet-500 text-white rounded-xl transition-all shadow-md shadow-purple-200/50 active:scale-95 hover:shadow-lg hover:shadow-purple-200/60">
            <i className="fa-solid fa-film text-base"></i>
            <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest">Reels</span>
          </button>
          <button onClick={() => setShowProductAd(true)} title="Producto → Publicidad" className="h-10 w-10 lg:w-auto lg:px-4 flex items-center justify-center gap-2 bg-white text-slate-600 border border-slate-200 rounded-xl transition-all shadow-sm shadow-slate-200/50 active:scale-95 hover:border-emerald-200 hover:text-emerald-600">
            <i className="fa-solid fa-box-open text-base"></i>
            <span className="hidden lg:inline text-[10px] font-black uppercase tracking-widest">Producto</span>
          </button>
          <div className="w-px h-7 bg-slate-100 mx-0.5 hidden sm:block"></div>
          {user?.email && ADMIN_EMAILS.includes(user.email) && (
            <button onClick={() => setShowAdmin(!showAdmin)} title="Panel de Control" className={`h-10 w-10 flex items-center justify-center rounded-xl transition-all shadow-sm active:scale-95 ${showAdmin ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-400 border border-transparent hover:text-slate-600'}`}>
              <i className="fa-solid fa-shield-halved text-lg"></i>
            </button>
          )}
          <button onClick={handleLogout} title="Cerrar sesión" className="h-10 w-10 flex items-center justify-center bg-slate-50 text-slate-400 rounded-xl transition-all border border-transparent hover:text-slate-600 shadow-sm active:scale-95"><i className="fa-solid fa-right-from-bracket text-lg"></i></button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative pb-20 md:pb-0">
        <aside className={`w-full md:w-[400px] bg-white border-r border-slate-100 overflow-y-auto h-full z-20 pb-20 md:pb-0 ${activeTab === 'editor' ? 'block' : 'hidden md:block'}`}>
          <SidebarModules 
            state={state} 
            updateState={updateState} 
            profile={profile} 
            updateUsage={updateUsage} 
            openSection={openSection} 
            setOpenSection={setOpenSection} 
            activeLayout={activeLayout}
            selectedField={selectedField}
            onApplyTemplate={applyTemplate}
            githubToken={githubToken}
            onGithubConnect={handleGithubConnect}
            onGithubDisconnect={handleGithubDisconnect}
            compressBase64Image={compressBase64Image}
            pendingPrompt={pendingPrompt}
            onPendingPromptConsumed={() => setPendingPrompt(null)}
            savedProjects={savedProjects}
            onLoadProject={(projectState) => {
              console.log("Loading project state:", projectState);
              
              setState(prev => {
                // Hacemos un merge profundo básico para asegurar que no falten objetos anidados
                const newState = {
                  ...DEFAULT_STATE,
                  ...projectState,
                  feedBackgroundConfig: { ...DEFAULT_STATE.feedBackgroundConfig, ...(projectState.feedBackgroundConfig || {}) },
                  storyBackgroundConfig: { ...DEFAULT_STATE.storyBackgroundConfig, ...(projectState.storyBackgroundConfig || {}) },
                  logo: { ...DEFAULT_STATE.logo, ...(projectState.logo || {}) },
                  resource: { ...DEFAULT_STATE.resource, ...(projectState.resource || {}) },
                  textLayers: {
                    headline: { ...DEFAULT_STATE.textLayers.headline, ...(projectState.textLayers?.headline || {}) },
                    description: { ...DEFAULT_STATE.textLayers.description, ...(projectState.textLayers?.description || {}) },
                    additional: { ...DEFAULT_STATE.textLayers.additional, ...(projectState.textLayers?.additional || {}) },
                    cta: { ...DEFAULT_STATE.textLayers.cta, ...(projectState.textLayers?.cta || {}) }
                  },
                  // Preservamos las librerías y activos del usuario al cargar un proyecto
                  logoLibrary: prev.logoLibrary,
                  backgroundLibrary: prev.backgroundLibrary,
                  resourceLibrary: prev.resourceLibrary,
                  customFonts: prev.customFonts,
                  brandKits: prev.brandKits,
                };
                console.log("New merged state:", newState);
                return newState;
              });
              
              // Cerramos el sidebar en móvil para que el usuario vea el canvas
              if (window.innerWidth < 768) {
                setOpenSection(null);
              }
            }}
            onDeleteProject={async (projectId) => {
              if (window.confirm('¿Estás seguro de que deseas eliminar este diseño?')) {
                try {
                  await db.collection('usuarios').doc(user.uid).collection('disenos').doc(projectId).delete();
                } catch (e) {
                  console.error("Error al eliminar proyecto:", e);
                }
              }
            }}
          />
        </aside>
        <section ref={previewSectionRef} className={`flex-1 overflow-y-auto h-full p-6 md:p-12 bg-[#F8F9FA] transition-all duration-300 ease-in-out ${activeTab === 'preview' ? 'block' : 'hidden md:block'} ${showDrawer ? 'pb-[220px]' : ''}`}>
          <div className={`md:hidden fixed bottom-24 right-6 z-[60] flex flex-col items-end gap-3 pointer-events-none transition-opacity duration-300 ${showDrawer || showAdmin ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}>
            {showLensMenu && (
              <div className="bg-white/80 backdrop-blur-xl border border-white/40 shadow-2xl rounded-[32px] p-5 w-64 space-y-6 pointer-events-auto animate-in fade-in slide-in-from-bottom-5 duration-300">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">Guías Técnicas</span>
                  <button 
                    onClick={() => updateState({ feedShowGuides: !state.feedShowGuides, storyShowGuides: !state.feedShowGuides })} 
                    className={`w-11 h-6 rounded-full transition-all border relative ${state.feedShowGuides ? 'bg-[#EA5B25] border-[#EA5B25]' : 'bg-slate-400 border-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${state.feedShowGuides ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                
                {/* NUEVO: FILTRO RÁPIDO EN MENÚ LENTE */}
                <div className="space-y-4 pt-2 border-t border-slate-100">
                   <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-black text-[#EA5B25] uppercase tracking-widest">Filtro Fondo</span>
                      <span className="text-[11px] font-black text-[#EA5B25]">{state.feedOverlayOpacity}%</span>
                   </div>
                   <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                      {['#000000', '#FFFFFF', '#EA5B25', ...state.extractedColors].slice(0, 5).map(c => (
                        <button 
                          key={`lens-filt-${c}`}
                          onClick={() => updateState({ backgroundOverlayColor: c })}
                          className={`shrink-0 w-8 h-8 rounded-full border-2 transition-all ${state.backgroundOverlayColor === c ? 'border-[#EA5B25] scale-110 shadow-md' : 'border-white'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                   </div>
                   <div className="flex items-center gap-3">
                     <i className="fa-solid fa-moon text-slate-300 text-xs"></i>
                     <input type="range" min="0" max="85" value={state.feedOverlayOpacity} onChange={(e) => updateState({ feedOverlayOpacity: Number(e.target.value), storyOverlayOpacity: Number(e.target.value) })} className="flex-1 h-1.5 accent-[#EA5B25] bg-slate-100 rounded-full appearance-none cursor-pointer" />
                   </div>
                </div>
              </div>
            )}
            <button onClick={() => setShowLensMenu(!showLensMenu)} className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 pointer-events-auto border-2 ${showLensMenu ? 'bg-slate-900 border-slate-800 text-white rotate-90' : 'bg-[#EA5B25] border-white text-white'}`}><i className={`fa-solid ${showLensMenu ? 'fa-xmark' : 'fa-layer-group'} text-xl`}></i></button>
          </div>
          <div className="max-w-[340px] mx-auto space-y-12 md:space-y-24 pb-40">
            <div className="space-y-6">
              <div className="flex items-center justify-between px-2">
                <span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Feed (4:5)</span>
                <div className="flex gap-2">
                  <button onClick={() => saveProject('feed-canvas')} className="bg-slate-100 text-slate-600 px-4 py-2.5 rounded-full text-[10px] font-black uppercase transition-all active:scale-95 hover:bg-slate-200" title="Guardar Proyecto"><i className="fa-solid fa-floppy-disk"></i></button>
                  <button onClick={() => exportLayout('feed-canvas', 'feed.png')} className={`bg-[#EA5B25] text-white px-7 py-2.5 rounded-full text-[10px] font-black uppercase transition-all active:scale-95 ${exportingId === 'feed-canvas' ? 'opacity-50 cursor-wait' : ''}`}>{exportingId === 'feed-canvas' ? 'Exportando...' : 'Exportar'}</button>
                </div>
              </div>
              <EditorCanvas id="feed-canvas" isExporting={exportingId === 'feed-canvas'} state={state} selectedField={selectedField} onUpdateText={(key, updates) => onUpdateText(key, updates, 'feed')} onUpdateLogo={(updates) => onUpdateLogo(updates, 'feed')} onUpdateResource={(updates) => onUpdateResource(updates, 'feed')} onUpdateBackground={(upd) => updateState({ feedBackgroundConfig: { ...state.feedBackgroundConfig, ...upd } })} aspectRatio="4:5" showSafeZones={state.feedShowGuides} onToggleGuides={() => updateState({ feedShowGuides: !state.feedShowGuides, storyShowGuides: !state.feedShowGuides })} onUpdateOpacity={(val) => updateState({ feedOverlayOpacity: val, storyOverlayOpacity: val })} onSelectLayer={(key) => onSelectLayer(key, 'feed')} onApplyStyle={applyDesignStyle} onSelectVariant={(idx) => updateState({ selectedVariantIndex: idx })} />
            </div>
            <div className="space-y-6">
              <div className="flex items-center justify-between px-2">
                <span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Story (9:16)</span>
                <div className="flex gap-2">
                  <button onClick={() => saveProject('story-canvas')} className="bg-slate-100 text-slate-600 px-4 py-2.5 rounded-full text-[10px] font-black uppercase transition-all active:scale-95 hover:bg-slate-200" title="Guardar Proyecto"><i className="fa-solid fa-floppy-disk"></i></button>
                  <button onClick={() => exportLayout('story-canvas', 'story.png')} className={`bg-[#EA5B25] text-white px-7 py-2.5 rounded-full text-[10px] font-black uppercase transition-all active:scale-95 ${exportingId === 'story-canvas' ? 'opacity-50 cursor-wait' : ''}`}>{exportingId === 'story-canvas' ? 'Exportando...' : 'Exportar'}</button>
                </div>
              </div>
              <EditorCanvas id="story-canvas" isExporting={exportingId === 'story-canvas'} state={state} selectedField={selectedField} onUpdateText={(key, updates) => onUpdateText(key, updates, 'story')} onUpdateLogo={(updates) => onUpdateLogo(updates, 'story')} onUpdateResource={(updates) => onUpdateResource(updates, 'story')} onUpdateBackground={(upd) => updateState({ storyBackgroundConfig: { ...state.storyBackgroundConfig, ...upd } })} aspectRatio="9:16" showSafeZones={state.storyShowGuides} onToggleGuides={() => updateState({ storyShowGuides: !state.storyShowGuides, feedShowGuides: !state.feedShowGuides })} onUpdateOpacity={(val) => updateState({ feedOverlayOpacity: val, storyOverlayOpacity: val })} onSelectLayer={(key) => onSelectLayer(key, 'story')} onApplyStyle={applyDesignStyle} onSelectVariant={(idx) => updateState({ selectedVariantIndex: idx })} />
            </div>
          </div>
        </section>
      </main>

      <nav className="h-20 bg-white border-t border-slate-100 flex items-center justify-around fixed bottom-0 left-0 right-0 z-40 md:hidden shadow-lg">
        <button onClick={() => setActiveTab('editor')} className={`flex flex-col items-center gap-1 ${activeTab === 'editor' ? 'text-[#EA5B25]' : 'text-slate-300'}`}><i className="fa-solid fa-pen-to-square"></i><span className="text-[9px] font-black uppercase">Editor</span></button>
        <button onClick={() => setActiveTab('preview')} className={`flex flex-col items-center gap-1 ${activeTab === 'preview' ? 'text-[#EA5B25]' : 'text-slate-300'}`}><i className="fa-solid fa-eye"></i><span className="text-[9px] font-black uppercase">Preview</span></button>
      </nav>

      <div className="md:hidden">
         <QuickEditDrawer isOpen={showDrawer} onClose={() => setShowDrawer(false)} selectedField={selectedField} state={state} activeLayout={activeLayout} updateState={updateState} extractedColors={state.extractedColors} extractedBackgroundColors={state.extractedBackgroundColors} onUpdateBackground={(upd) => { if (selectedField === 'background' || selectedField === 'image') { const configKey = activeLayout === 'feed' ? 'feedBackgroundConfig' : 'storyBackgroundConfig'; updateState({ [configKey]: { ...state[configKey as keyof ProjectState] as any, ...upd } }); } }} />
      </div>
    </div>
  );
};

export default App;