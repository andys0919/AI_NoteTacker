# AI NoteTaker — deployment shortcuts.
#
# Production always uses base + screenapp so the recording-worker runs the real
# meeting bot (RECORDING_EXECUTOR=screenapp). Never bring the stack up with bare
# `docker compose up` — that drops the override and silently reverts to the stub
# recorder (no real Zoom/Google/Teams recording).

COMPOSE_PROD = docker compose -f docker-compose.yml -f docker-compose.screenapp.yml
COMPOSE_SMOKE = docker compose -f docker-compose.yml -f docker-compose.smoke.yml

.PHONY: deploy up restart down logs ps smoke test

## deploy: build + (re)create the full production stack
deploy:
	./scripts/deploy.sh up

## up: alias for deploy
up: deploy

## restart: recreate the production stack without rebuilding images
restart:
	./scripts/deploy.sh restart

## down: stop and remove the stack
down:
	./scripts/deploy.sh down

## logs: follow logs (use `make logs SVC=control-plane` for one service)
logs:
	$(COMPOSE_PROD) logs -f $(SVC)

## ps: show stack status
ps:
	$(COMPOSE_PROD) ps

## smoke: bring up the local smoke stack (stub recorder, on purpose)
smoke:
	./scripts/deploy.sh smoke

## test: run the control-plane and recording-worker test suites
test:
	npm exec --workspace @ai-notetacker/control-plane -- vitest run
	npm exec --workspace @ai-notetacker/recording-worker -- vitest run
