export type ImageSpeed = 'fast' | 'medium' | 'slow';
export type ImageProviderType = 'cloudflare' | 'oxlo' | 'pollinations' | 'nvidia';

export interface ImageModelEntry {
  id: string;
  provider: ImageProviderType;
  realModel: string;
  apiKeys: string[];
  strengths: string[];
  speed: ImageSpeed;
  maxResolution: { width: number; height: number };
  supportsNegativePrompt: boolean;
  supportsImageEdit: boolean;
  hasWatermark: boolean;
  enabled: boolean;
}

export function getImageModelRegistry(): ImageModelEntry[] {
  // Cloudflare credentials
  const cfKey = process.env.CLOUDFLARE_API_KEY || (process.env.NODE_ENV === 'test' ? 'cf-test-mock-key' : '');
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || (process.env.NODE_ENV === 'test' ? 'cf-test-account' : '');
  const cfKeys = cfKey.split(',').map((k) => k.trim()).filter(Boolean);

  // Oxlo credentials
  const oxloRaw: string[] = [];
  if (process.env.OXLO_API_KEY) oxloRaw.push(process.env.OXLO_API_KEY);
  if (process.env.OXLO_API_KEYS) oxloRaw.push(...process.env.OXLO_API_KEYS.split(','));
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`OXLO_API_KEY_${i}`];
    if (k) oxloRaw.push(k);
  }
  const oxloKeys = Array.from(new Set(oxloRaw.map((k) => k.trim()).filter(Boolean)));

  // NVIDIA credentials
  const nvRaw: string[] = [];
  if (process.env.NVIDIA_API_KEY) nvRaw.push(process.env.NVIDIA_API_KEY);
  if (process.env.NVIDIA_API_KEYS) nvRaw.push(...process.env.NVIDIA_API_KEYS.split(','));
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`NVIDIA_API_KEY_${i}`];
    if (k) nvRaw.push(k);
  }
  const nvKeys = Array.from(new Set(nvRaw.map((k) => k.trim()).filter(Boolean)));

  return [
    // 1. Cloudflare Flux-2 Klein 9B: Premier photorealism, text rendering, high detail
    {
      id: 'cf-flux-2-klein-9b',
      provider: 'cloudflare',
      realModel: '@cf/black-forest-labs/flux-2-klein-9b',
      apiKeys: cfKeys,
      strengths: [
        'photorealistic',
        'portrait',
        'realistic',
        'photo',
        'animal',
        'landscape',
        'product',
        'text',
        'typography',
        'logo',
        'poster',
        'sign',
        'high-detail',
        'edit',
      ],
      speed: 'medium',
      maxResolution: { width: 1024, height: 1024 },
      supportsNegativePrompt: false,
      supportsImageEdit: true,
      hasWatermark: false,
      enabled: cfKeys.length > 0 && !!cfAccountId,
    },
    // 2. Cloudflare Flux-2 Klein 4B: Ultra-fast generation, drafts, sketches
    {
      id: 'cf-flux-2-klein-4b',
      provider: 'cloudflare',
      realModel: '@cf/black-forest-labs/flux-2-klein-4b',
      apiKeys: cfKeys,
      strengths: [
        'fast',
        'draft',
        'quick',
        'simple',
        'sketch',
        'low-detail',
        'cartoon',
      ],
      speed: 'fast',
      maxResolution: { width: 1024, height: 1024 },
      supportsNegativePrompt: false,
      supportsImageEdit: false,
      hasWatermark: false,
      enabled: cfKeys.length > 0 && !!cfAccountId,
    },
    // 3. Oxlo Stable Diffusion 1.5: Stylized art, anime, illustrations, paintings, 3D renders
    {
      id: 'oxlo-sd-1.5',
      provider: 'oxlo',
      realModel: 'stable-diffusion-1.5',
      apiKeys: oxloKeys,
      strengths: [
        'anime',
        'cartoon',
        'illustration',
        'pixel art',
        'sketch',
        'painting',
        '3d render',
        'artistic',
        'stylized',
      ],
      speed: 'medium',
      maxResolution: { width: 512, height: 512 },
      supportsNegativePrompt: true,
      supportsImageEdit: false,
      hasWatermark: false,
      enabled: oxloKeys.length > 0,
    },
    // 4. Pollinations FLUX: Zero-auth, high-fidelity universal fallback
    {
      id: 'pollinations-flux',
      provider: 'pollinations',
      realModel: 'flux',
      apiKeys: [],
      strengths: [
        'fallback',
        'universal',
        'photorealistic',
        'illustration',
      ],
      speed: 'medium',
      maxResolution: { width: 1024, height: 1024 },
      supportsNegativePrompt: false,
      supportsImageEdit: false,
      hasWatermark: false,
      enabled: true,
    },
  ];
}

