#!/usr/bin/env bash
# A runtime just big enough for the daemon, so the installed app needs no Java on the machine.
# Run on the OS you are packaging for (jlink emits a runtime for the JDK it runs from).
set -euo pipefail
cd "$(dirname "$0")/.."
JAR=../daemon/target/keel-daemon.jar
[ -f "$JAR" ] || { echo "build the daemon first: make daemon"; exit 1; }
JH="${JAVA_HOME:-$(/usr/libexec/java_home -v 21 2>/dev/null || echo /usr/lib/jvm/java-21-openjdk-amd64)}"
WORK=$(mktemp -d)
( cd "$WORK" && unzip -q "$OLDPWD/$JAR" )
# The modules the daemon and its libraries actually touch; jdk.crypto.ec for TLS to AWS, jdk.unsupported for netty/pty4j.
MODS=$("$JH/bin/jdeps" --print-module-deps --ignore-missing-deps -q --multi-release 21 --class-path "$WORK/BOOT-INF/lib/*" "$WORK/BOOT-INF/classes" 2>/dev/null || echo java.base)
MODS="$MODS,jdk.crypto.ec,jdk.unsupported,java.management,java.naming,java.sql,java.xml,java.desktop,jdk.zipfs"
rm -rf jre
"$JH/bin/jlink" --add-modules "$MODS" --strip-debug --no-man-pages --no-header-files --compress zip-6 --output jre
rm -rf "$WORK"
echo "jre/ built with modules: $MODS"
du -sh jre
