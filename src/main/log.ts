import { app } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Log em arquivo.
 *
 * No Windows o Electron é um app de subsistema gráfico: `console.log` do
 * processo principal não chega ao terminal que abriu o programa. Sem arquivo,
 * um app empacotado que falha ao iniciar não deixa nenhuma pista — foi
 * exatamente assim que a janela sumiu sem nenhuma mensagem.
 */

const MAX_BYTES = 512 * 1024;

function filePath(): string {
  return join(app.getPath('userData'), 'only.log');
}

export function logToFile(scope: string, message: string): void {
  const line = `${new Date().toISOString()} [${scope}] ${message}\n`;
  console.log(line.trimEnd());

  try {
    const path = filePath();
    mkdirSync(app.getPath('userData'), { recursive: true });

    // Gira o arquivo para não crescer sem limite numa sessão longa.
    try {
      if (statSync(path).size > MAX_BYTES) renameSync(path, `${path}.old`);
    } catch {
      // Arquivo ainda não existe: nada a girar.
    }

    appendFileSync(path, line, 'utf-8');
  } catch {
    // Se nem log dá para escrever, não há o que fazer além de seguir.
  }
}

/** Envolve uma etapa da inicialização para saber exatamente onde parou. */
export function step<T>(name: string, run: () => T): T | undefined {
  try {
    logToFile('boot', `${name}…`);
    const result = run();
    logToFile('boot', `${name} ok`);
    return result;
  } catch (error) {
    logToFile('boot', `${name} FALHOU: ${error instanceof Error ? error.stack : String(error)}`);
    return undefined;
  }
}
