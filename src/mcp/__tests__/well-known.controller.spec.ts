import 'reflect-metadata';

import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';

import { ALL_MCP_SCOPES } from '../constants';
import {
  MCP_OAUTH_ISSUER_ENV,
  MCP_OAUTH_RESOURCE_URI_ENV,
} from '../oauth.constants';
import { WellKnownController } from '../well-known.controller';

/**
 * REFORMA 2 F1 — `GET /.well-known/oauth-protected-resource` (RFC 9728).
 *
 * DoD:
 *   (a) envs OAuth setadas → 200 + JSON com resource/authorization_servers/
 *       scopes_supported (== ALL_MCP_SCOPES)/bearer_methods_supported;
 *   (b) sem envs → 404 (NotFoundException);
 *   (c) controller SEM guards (metadata reflection);
 *   (d) NET-ZERO.
 */
describe('REFORMA 2 F1 — WellKnownController (oauth-protected-resource)', () => {
  const RESOURCE = 'https://host.example.com/mcp';
  const ISSUER = 'https://tenant.us.auth0.com/';

  /** ConfigService fake que devolve valores de um mapa por env name. */
  const makeConfig = (values: Record<string, string | undefined>): ConfigService =>
    ({
      get: (key: string): string | undefined => values[key],
    }) as unknown as ConfigService;

  describe('DoD (a): envs OAuth configuradas → 200 + metadata', () => {
    it('devolve o metadata completo derivado de config + ALL_MCP_SCOPES', () => {
      const controller = new WellKnownController(
        makeConfig({
          [MCP_OAUTH_RESOURCE_URI_ENV]: RESOURCE,
          [MCP_OAUTH_ISSUER_ENV]: ISSUER,
        }),
      );

      const result = controller.getProtectedResourceMetadata();

      expect(result.resource).toBe(RESOURCE);
      expect(result.authorization_servers).toEqual([ISSUER]);
      expect(result.scopes_supported).toEqual([...ALL_MCP_SCOPES]);
      expect(result.bearer_methods_supported).toEqual(['header']);
    });

    it('reutiliza EXATAMENTE ALL_MCP_SCOPES (ADR-V2-068), sem inventar scopes', () => {
      const controller = new WellKnownController(
        makeConfig({
          [MCP_OAUTH_RESOURCE_URI_ENV]: RESOURCE,
          [MCP_OAUTH_ISSUER_ENV]: ISSUER,
        }),
      );

      const result = controller.getProtectedResourceMetadata();

      // Mesmo conteúdo do catálogo canônico, mas cópia (não a referência viva).
      expect(result.scopes_supported).toEqual(ALL_MCP_SCOPES);
      expect(result.scopes_supported).not.toBe(ALL_MCP_SCOPES);
    });

    it('trim: envs com espaços em volta ainda resolvem', () => {
      const controller = new WellKnownController(
        makeConfig({
          [MCP_OAUTH_RESOURCE_URI_ENV]: `  ${RESOURCE}  `,
          [MCP_OAUTH_ISSUER_ENV]: `  ${ISSUER}  `,
        }),
      );

      const result = controller.getProtectedResourceMetadata();

      expect(result.resource).toBe(RESOURCE);
      expect(result.authorization_servers).toEqual([ISSUER]);
    });
  });

  describe('DoD (b): envs OAuth ausentes → 404', () => {
    it('lança NotFoundException quando ambas as envs estão ausentes', () => {
      const controller = new WellKnownController(makeConfig({}));

      expect(() => controller.getProtectedResourceMetadata()).toThrow(NotFoundException);
    });

    it('lança NotFoundException quando SÓ o resource está ausente', () => {
      const controller = new WellKnownController(
        makeConfig({ [MCP_OAUTH_ISSUER_ENV]: ISSUER }),
      );

      expect(() => controller.getProtectedResourceMetadata()).toThrow(NotFoundException);
    });

    it('lança NotFoundException quando SÓ o issuer está ausente', () => {
      const controller = new WellKnownController(
        makeConfig({ [MCP_OAUTH_RESOURCE_URI_ENV]: RESOURCE }),
      );

      expect(() => controller.getProtectedResourceMetadata()).toThrow(NotFoundException);
    });

    it('lança NotFoundException quando as envs são strings vazias/whitespace', () => {
      const controller = new WellKnownController(
        makeConfig({
          [MCP_OAUTH_RESOURCE_URI_ENV]: '   ',
          [MCP_OAUTH_ISSUER_ENV]: '',
        }),
      );

      expect(() => controller.getProtectedResourceMetadata()).toThrow(NotFoundException);
    });
  });

  describe('DoD (c): discovery é público (sem guards)', () => {
    /** Lê os guards declarados por @UseGuards no método (array de classes). */
    const guardsOfMethod = (method: keyof WellKnownController): unknown[] =>
      (Reflect.getMetadata(
        GUARDS_METADATA,
        WellKnownController.prototype[method] as object,
      ) as unknown[] | undefined) ?? [];

    /** Lê os guards declarados por @UseGuards na classe. */
    const guardsOfClass = (): unknown[] =>
      (Reflect.getMetadata(GUARDS_METADATA, WellKnownController) as unknown[] | undefined) ?? [];

    it('o handler não declara nenhum guard', () => {
      expect(guardsOfMethod('getProtectedResourceMetadata')).toHaveLength(0);
    });

    it('a classe não declara nenhum guard', () => {
      expect(guardsOfClass()).toHaveLength(0);
    });
  });
});
