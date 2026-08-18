import type { OutgoingAttachment } from '@shared/ipc';

/**
 * Prepara a imagem antes de mandar pela rede.
 *
 * Um print de tela moderno passa de 5 MB em PNG. Mandar isso cru entope a
 * conexão do host e infla o histórico de todo mundo, então reduzimos e
 * recomprimimos para WebP — que a ~80% de qualidade fica visualmente igual com
 * uma fração do tamanho. GIF passa intacto: recomprimir mataria a animação.
 */

/** Maior lado da imagem depois do redimensionamento. */
const MAX_DIMENSION = 1920;

export async function compressImage(
  file: File,
  maxMb: number,
  quality: number,
): Promise<OutgoingAttachment> {
  const maxBytes = Math.max(1, maxMb) * 1024 * 1024;

  if (file.type === 'image/gif') {
    if (file.size > maxBytes) {
      throw new Error(`GIF acima do limite de ${maxMb} MB — não dá para recomprimir sem perder a animação`);
    }
    const bitmap = await createImageBitmap(file).catch(() => null);
    return {
      name: file.name,
      mimeType: 'image/gif',
      dataUrl: await readAsDataUrl(file),
      width: bitmap?.width ?? 0,
      height: bitmap?.height ?? 0,
    };
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('não foi possível processar a imagem');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Se ainda passar do teto, cai a qualidade em degraus antes de desistir.
  let currentQuality = Math.min(100, Math.max(30, quality)) / 100;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dataUrl = canvas.toDataURL('image/webp', currentQuality);
    if (estimateBytes(dataUrl) <= maxBytes) {
      return { name: renameToWebp(file.name), mimeType: 'image/webp', dataUrl, width, height };
    }
    currentQuality *= 0.7;
  }

  throw new Error(`imagem grande demais mesmo comprimida — o limite é ${maxMb} MB`);
}

function renameToWebp(name: string): string {
  return `${name.replace(/\.[^.]+$/, '')}.webp`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('não foi possível ler o arquivo'));
    reader.readAsDataURL(file);
  });
}

function estimateBytes(dataUrl: string): number {
  return Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);
}
