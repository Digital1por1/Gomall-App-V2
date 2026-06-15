
export interface Position {
  x: number;
  y: number;
}

export interface BackgroundConfig {
  scale: number;
  offset: Position;
}

export interface UsageData {
  tokensUsed: number;
  lastReset: number; // Timestamp
  lastUsed?: number; // Timestamp
}

export interface UserProfile {
  name: string;
  business: string;
  mall: string;
  type?: 'comercio' | 'mall';
  tokenLimit?: number;
  plan?: string;
  isBlocked?: boolean;
  email?: string;
  usage?: UsageData;
  // Identidad de marca (onboarding)
  companyStory?: string;
  industry?: string;
  brandTone?: string;
  website?: string;
  onboardingCompleted?: boolean;
  logoLibrary?: string[];
  resourceLibrary?: string[];
  backgroundLibrary?: string[];
  currentLogoUrl?: string;
  currentResourceUrl?: string;
  brandKits?: BrandKit[];
  customFonts?: CustomFont[];
  campaigns?: Campaign[];
  plannedPosts?: PlannedPost[];
  usageStats?: {
    totalTokens?: number;
    totalCalls?: number;
    lastUpdated?: number;
    [action: string]: { calls?: number; tokens?: number } | number | undefined;
  };
  lastUsedFonts?: {
    headline: string;
    description: string;
    additional: string;
    cta: string;
  };
  lastUsedColors?: {
    headline: string;
    description: string;
    additional: string;
    cta: string;
    ctaBg: string;
  };
}

export interface TextLayer {
  content: string;
  font: string;
  size: number;
  color: string;
  backgroundColor: string; // Nueva propiedad
  align: 'left' | 'center' | 'right';
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOffset: number;
  feedPosition: Position;
  storyPosition: Position;
  width: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  lineHeight: number;
}

export interface LogoSettings {
  url: string | null;
  size: number;
  opacity: number;
  feedPosition: Position;
  storyPosition: Position;
}

export interface ResourceSettings {
  url: string | null;
  size: number;
  opacity: number;
  feedPosition: Position;
  storyPosition: Position;
}

export interface ImageVariant {
  id: string;
  url: string;
  prompt: string;
}

export interface CustomFont {
  name: string;
  family: string;
  url: string;
}

export interface BrandKit {
  id: string;
  name: string;
  logoUrls: string[];
  resourceUrls: string[];
  headlineFont: string;
  descriptionFont: string;
  additionalFont: string;
  ctaFont: string;
  headlineColor: string;
  descriptionColor: string;
  additionalColor: string;
  ctaColor: string;
  ctaBgColor: string;
  brandColors: string[];
  overlayColor?: string;
}

export interface PlannedPost {
  id: string;
  date: string;      // YYYY-MM-DD
  title: string;
  note?: string;
  done?: boolean;
}

export interface CampaignPiece {
  id: string;
  type: 'imagen' | 'reel' | 'copy';
  title: string;
  format: string;        // ej: "Feed 4:5", "Story 9:16", "Reel 9:16"
  imagePrompt: string;   // prompt sugerido para generar la imagen/reel
  copy: string;          // caption/copy sugerido
  rationale: string;     // por qué se recomienda esta pieza
}

export interface Campaign {
  id: string;
  name: string;
  objective: string;
  audience: string;
  product: string;
  dates: string;
  platforms: string[];
  keyMessage: string;
  pieces: CampaignPiece[];
  createdAt: number;
}

export interface ProjectState {
  id?: string;
  title: string;
  imageVariants: ImageVariant[];
  selectedVariantIndex: number;
  feedBackgroundConfig: BackgroundConfig;
  storyBackgroundConfig: BackgroundConfig;
  logo: LogoSettings;
  resource: ResourceSettings;
  textLayers: {
    headline: TextLayer;
    description: TextLayer;
    additional: TextLayer;
    cta: TextLayer;
  };
  feedOverlayOpacity: number;
  storyOverlayOpacity: number;
  backgroundOverlayColor: string; // Nueva propiedad
  feedShowGuides: boolean;
  storyShowGuides: boolean;
  feedShowIgOverlay: boolean;
  storyShowIgOverlay: boolean;
  selectedCopyIndex: number | null;
  copies: string[];
  showCta: boolean;
  showCtaBg: boolean;
  ctaBgColor: string;
  ctaPaddingX: number;
  ctaPaddingY: number;
  customFonts: CustomFont[];
  brandKits: BrandKit[];
  logoLibrary: string[];
  resourceLibrary: string[];
  backgroundLibrary: string[];
  extractedColors: string[];
  extractedBackgroundColors: string[];
  layersOrder: string[];
}

export interface SavedProject {
  id: string;
  userId: string;
  state: ProjectState | string;
  thumbnail?: string;
  updatedAt: any;
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  timestamp: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  groundingUrls?: { uri: string; title: string }[];
}