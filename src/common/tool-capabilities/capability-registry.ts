import { Injectable } from '@nestjs/common';

import { Capability } from './capability.interface';

/**
 * `CapabilityRegistry` — registro central das capabilities (fonte unica).
 *
 * E o ponto de verdade do qual AMBOS os adapters (MCP e Nexus) derivam a lista
 * de tools. Na Onda 0 nasce VAZIO — nenhuma capability e registrada ainda
 * (MCP e Nexus continuam servindo suas tools atuais pelo caminho antigo).
 * As Ondas 1..6 registram capabilities aqui, uma por tool migrada.
 *
 * O guard-rail de paridade (Onda 0.4) compara o que cada adapter expoe a partir
 * deste registry contra o manifesto de isencoes, e falha o CI se divergirem.
 *
 * Injetavel como provider NestJS singleton (uma instancia por app).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 0.2
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */
@Injectable()
export class CapabilityRegistry {
  /** Capabilities registradas, chaveadas pelo nome canonico snake_case. */
  private readonly capabilities = new Map<string, Capability>();

  /**
   * Registra uma capability. O nome deve ser unico no registry.
   *
   * @param capability - Capability a registrar.
   * @throws {Error} Se ja existir capability com o mesmo `name` (colisao =
   *   bug de wiring; falha cedo em vez de sobrescrever silenciosamente).
   */
  register(capability: Capability): void {
    if (this.capabilities.has(capability.name)) {
      throw new Error(`Capability duplicada no registry: "${capability.name}"`);
    }
    this.capabilities.set(capability.name, capability);
  }

  /**
   * Retorna a capability pelo nome, ou `undefined` se nao registrada.
   *
   * @param name - Nome canonico snake_case.
   */
  get(name: string): Capability | undefined {
    return this.capabilities.get(name);
  }

  /**
   * Verifica se ha capability registrada com o nome.
   *
   * @param name - Nome canonico snake_case.
   */
  has(name: string): boolean {
    return this.capabilities.has(name);
  }

  /**
   * Lista todas as capabilities registradas (snapshot — ordem de insercao).
   * Usada pelos adapters para construir suas listas de tools e pelo teste de
   * paridade.
   */
  list(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * Lista os nomes canonicos de todas as capabilities registradas.
   * Atalho para o teste de paridade (comparacao por nome).
   */
  names(): string[] {
    return Array.from(this.capabilities.keys());
  }

  /** Numero de capabilities registradas. */
  get size(): number {
    return this.capabilities.size;
  }
}
