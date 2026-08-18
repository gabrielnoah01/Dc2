import { createRequire } from 'node:module';
import { APP_NAME } from '../../shared/constants';

// A lib é CommonJS; o require direto evita depender de interop de ESM, que o
// Node do Electron 33 ainda não faz para `require()`.
const nodeRequire = createRequire(__filename);

export type PortMappingStatus = 'mapped' | 'unavailable';

export interface PortMappingResult {
  status: PortMappingStatus;
  /** Motivo legível quando o mapeamento não foi possível. */
  detail?: string;
  /**
   * IP que o roteador enxerga como "externo". Se ele for privado, existe outro
   * NAT acima (CGNAT da operadora) e o link de internet não vai funcionar por
   * mais que a porta esteja aberta aqui.
   */
  routerExternalIp?: string;
  behindCarrierNat?: boolean;
}

interface UpnpMapping {
  public: { host: string; port: number };
  private: { host: string; port: number };
  description: string;
  enabled: boolean;
}

interface UpnpClient {
  createMapping(options: {
    public: number;
    private: number;
    ttl: number;
    protocol: string;
    description: string;
  }): Promise<unknown>;
  removeMapping(options: { public: number; protocol: string }): Promise<unknown>;
  getMappings(): Promise<UpnpMapping[]>;
  getPublicIp(): Promise<string>;
  close(): void;
}

let client: UpnpClient | null = null;
let mappedPort: number | null = null;

/**
 * Tenta abrir a porta automaticamente via UPnP. Falhar aqui é normal (roteador
 * com UPnP desligado) e nunca deve impedir o servidor de subir: a UI cai no
 * fallback de port-forward manual / rede local.
 */
export async function mapPort(port: number, timeoutMs = 8000): Promise<PortMappingResult> {
  try {
    const { Client } = nodeRequire('@runonflux/nat-upnp');
    const active = new Client({ timeout: timeoutMs }) as UpnpClient;

    await createMappingWithRecovery(active, port);

    client = active;
    mappedPort = port;

    // O IP do roteador é mais confiável que um serviço externo para detectar
    // CGNAT — e não custa nada, já estamos falando com ele.
    let routerExternalIp: string | undefined;
    try {
      routerExternalIp = await active.getPublicIp();
    } catch {
      // sem isso só perdemos o aviso de CGNAT
    }

    return {
      status: 'mapped',
      routerExternalIp,
      behindCarrierNat: routerExternalIp ? isPrivateIp(routerExternalIp) : undefined,
    };
  } catch (error) {
    client = null;
    mappedPort = null;
    return { status: 'unavailable', detail: toMessage(error) };
  }
}

/** Desfaz o mapeamento ao encerrar o servidor — não deixa porta aberta atrás. */
export async function unmapPort(): Promise<void> {
  if (!client || mappedPort === null) return;
  const port = mappedPort;
  const active = client;
  client = null;
  mappedPort = null;

  try {
    await active.removeMapping({ public: port, protocol: 'TCP' });
  } catch {
    // Se o roteador não responder, o mapeamento expira sozinho pelo TTL.
  }

  try {
    active.close();
  } catch {
    // idem
  }
}

/**
 * Cria o mapeamento e se recupera do caso mais comum de falha: já existir uma
 * entrada para esta porta.
 *
 * Isso acontece toda vez que o app é encerrado sem passar pelo desligamento
 * limpo (queda de energia, fim de processo). O roteador guarda a entrada, e
 * daí em diante recusa qualquer nova com um HTTP 500 seco — que a lib repassa
 * como se o UPnP estivesse desligado. O usuário fica vendo "não consegui abrir
 * a porta" para sempre, num roteador que aceita UPnP sem problema.
 */
async function createMappingWithRecovery(active: UpnpClient, port: number): Promise<void> {
  const request = () =>
    active.createMapping({
      public: port,
      private: port,
      ttl: 3600,
      protocol: 'TCP',
      description: APP_NAME,
    });

  try {
    await request();
    return;
  } catch (error) {
    const existing = await findMapping(active, port);
    // Falhou e não há entrada conflitante: é problema de verdade.
    if (!existing) throw error;
  }

  // Tira a entrada velha da frente e tenta de novo.
  await active.removeMapping({ public: port, protocol: 'TCP' });
  await request();
}

async function findMapping(active: UpnpClient, port: number): Promise<UpnpMapping | null> {
  try {
    const mappings = await active.getMappings();
    return mappings.find((mapping) => mapping.public.port === port) ?? null;
  } catch {
    return null;
  }
}

/**
 * Faixas que nunca aparecem na internet aberta. `100.64/10` é a faixa reservada
 * para CGNAT — se o roteador reporta um IP desses, a operadora está
 * compartilhando um IP público entre vários clientes.
 */
function isPrivateIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
