import { Capacitor } from '@capacitor/core';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const isNative = () => Capacitor.isNativePlatform();

export async function copyText(text: string): Promise<boolean> {
  try {
    if (isNative()) {
      const { Clipboard } = await import('@capacitor/clipboard');
      await Clipboard.write({ string: text });
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallthrough */
  }
  // запасной вариант
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function readClipboardText(): Promise<string | null> {
  try {
    if (isNative()) {
      const { Clipboard } = await import('@capacitor/clipboard');
      const r = await Clipboard.read();
      if (r.type?.startsWith('text') || typeof r.value === 'string') return r.value;
      return null;
    }
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
  } catch {
    /* ignore */
  }
  return null;
}

/** Сохранить файл: на iOS/Android — через «Поделиться», на десктопе/вебе — скачивание */
export async function saveFile(name: string, content: string, mime = 'application/json') {
  if (isNative()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const res = await Filesystem.writeFile({ path: name, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, url: res.uri, dialogTitle: 'Сохранить копию' });
    return;
  }
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export function fileToDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Уменьшить слишком большие картинки, чтобы база не раздувалась */
export async function normalizeImage(dataUrl: string, maxSide = 2400): Promise<{ src: string; w: number; h: number }> {
  const img = await loadImage(dataUrl);
  let { naturalWidth: w, naturalHeight: h } = img;
  if (Math.max(w, h) <= maxSide) return { src: dataUrl, w, h };
  const k = maxSide / Math.max(w, h);
  w = Math.round(w * k);
  h = Math.round(h * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  const isPng = dataUrl.startsWith('data:image/png');
  return { src: c.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.9), w, h };
}
