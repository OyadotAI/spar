# keel-v2 — the gate is `make check`. Everything else is convenience.
JAVA_HOME ?= /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export JAVA_HOME
MVN := mvn -q -f daemon/pom.xml
JAR := daemon/target/keel-daemon.jar

.PHONY: check daemon daemon-test app-install app-test app-typecheck dev dist

check: daemon-test app-typecheck app-test   ## fmt-free gate: daemon tests + app typecheck + app tests

daemon: ## build the daemon fat jar
	$(MVN) -DskipTests package

daemon-test:
	$(MVN) test

app-install:
	cd app && pnpm install --frozen-lockfile 2>/dev/null || (cd app && pnpm install)

app-typecheck:
	cd app && pnpm typecheck

app-test:
	cd app && pnpm test

dev: daemon ## run the app in dev mode against a freshly built daemon
	cd app && KEEL_DAEMON_JAR=$(abspath $(JAR)) KEEL_JAVA=$(JAVA_HOME)/bin/java pnpm dev

dist: daemon ## installers for the current OS (dmg / nsis / AppImage), with a bundled JRE
	cd app && ./scripts/jre.sh && pnpm build && pnpm exec electron-builder
