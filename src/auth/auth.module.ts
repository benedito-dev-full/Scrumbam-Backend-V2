import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { EntidadesModule } from '../entidades/entidades.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
// OrganizationsModule importado via forwardRef para evitar circular dependency
// AuthModule → OrganizationsModule → AuthModule (guards)
import { OrganizationsModule } from '../organizations/organizations.module';
// InvitesModule importado via forwardRef para evitar circular dependency
// AuthModule → InvitesModule → AuthModule (issueSessionForUser p/ auto-login)
// Necessário para o endpoint GET /auth/pending-invites (Etapa 4 orphan-workspace).
import { InvitesModule } from '../invites/invites.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiKeyGuard } from './guards/api-key.guard';
import { McpKeyGuard } from './guards/mcp-key.guard';
import { AuthCompositeGuard } from './guards/auth-composite.guard';
import { OrgTenantGuard } from './guards/org-tenant.guard';
import { ProjectScopeGuard } from './guards/project-scope.guard';
import { RequireWorkspaceGuard } from './guards/require-workspace.guard';
import { RolesGuard } from './guards/roles.guard';
import { TeamRolesGuard } from './guards/team-roles.guard';
import { ApiKeyService } from './services/api-key.service';
import { McpKeyService } from './services/mcp-key.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { RoleResolverService } from './services/role-resolver.service';

/**
 * Módulo de autenticação e autorização.
 *
 * Provê e exporta todos os guards, services e estratégias de auth:
 * - JwtAuthGuard, ApiKeyGuard, McpKeyGuard, AuthCompositeGuard
 * - OrgTenantGuard, ProjectScopeGuard, RolesGuard, TeamRolesGuard
 * - JwtStrategy (Passport)
 *
 * Importado pelo AppModule. Exporta guards para uso em outros módulos.
 *
 * JWT configurado com JWT_SECRET + JWT_EXPIRES_IN do ConfigService.
 * Default: expiresIn=900s (15min).
 */
@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: (() => {
          const secret = configService.get<string>('JWT_SECRET');
          if (!secret) {
            throw new Error('JWT_SECRET não configurado. Adicione ao .env');
          }

          return secret;
        })(),
        signOptions: {
          expiresIn: parseInt(configService.get<string>('JWT_EXPIRES_IN', '900'), 10),
        },
      }),
    }),
    forwardRef(() => EntidadesModule),
    forwardRef(() => OrganizationsModule),
    forwardRef(() => InvitesModule),
  ],
  controllers: [AuthController],
  providers: [
    PrismaService,
    // Strategies
    JwtStrategy,
    // Services
    AuthService,
    ApiKeyService,
    McpKeyService,
    RefreshTokenService,
    RoleResolverService,
    // Guards
    JwtAuthGuard,
    ApiKeyGuard,
    McpKeyGuard,
    RequireWorkspaceGuard,
    AuthCompositeGuard,
    OrgTenantGuard,
    ProjectScopeGuard,
    RolesGuard,
    TeamRolesGuard,
  ],
  exports: [
    // Exportar guards para uso em outros módulos (EntidadesModule, TabelasModule, etc.)
    JwtAuthGuard,
    ApiKeyGuard,
    McpKeyGuard,
    RequireWorkspaceGuard,
    AuthCompositeGuard,
    OrgTenantGuard,
    ProjectScopeGuard,
    RolesGuard,
    TeamRolesGuard,
    // Exportar services usados em outros módulos
    AuthService,
    ApiKeyService,
    McpKeyService,
    RoleResolverService,
    RefreshTokenService,
    JwtModule,
    PassportModule,
  ],
})
export class AuthModule {}
