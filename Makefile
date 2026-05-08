.PHONY: help install dev build start test lint typecheck format seed migrate db-up db-down db-reset clean

help:
	@echo "Scrumban-Backend-V2 — comandos disponíveis"
	@echo ""
	@echo "  install        Instala dependências (npm install)"
	@echo "  dev            Inicia servidor em modo dev (watch)"
	@echo "  build          Build de produção"
	@echo "  start          Inicia build de produção"
	@echo "  test           Roda testes unit + integration"
	@echo "  lint           Lint + auto-fix"
	@echo "  typecheck      TypeScript check (strict)"
	@echo "  format         Prettier auto-format"
	@echo "  seed           Roda seed (classes + dados base)"
	@echo "  migrate        Roda migrations Prisma"
	@echo "  db-up          Sobe Postgres + Redis (docker-compose)"
	@echo "  db-down        Para containers"
	@echo "  db-reset       Reset completo do banco + reseed"
	@echo "  clean          Remove dist/ e node_modules/"

install:
	npm install
	npm run prisma:generate

dev:
	npm run start:dev

build:
	npm run build

start: build
	npm run start:prod

test:
	npm run test

lint:
	npm run lint

typecheck:
	npm run typecheck

format:
	npm run format

seed:
	npm run seed:classes
	npm run seed

migrate:
	npm run prisma:migrate

db-up:
	docker-compose up -d postgres redis

db-down:
	docker-compose down

db-reset:
	docker-compose down -v
	docker-compose up -d postgres redis
	@sleep 3
	npm run prisma:migrate:deploy
	$(MAKE) seed

clean:
	rm -rf dist node_modules
