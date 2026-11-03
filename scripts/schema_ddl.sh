#!/usr/bin/env bash
# Prints the CREATE statements Hibernate would use for the current entities (PostgreSQL dialect).
# Use it while writing a new migration: compare with the previous output to see which tables/columns changed.
#
#   scripts/schema_ddl.sh > /tmp/schema-new.sql
#
# Builds server/target/bingoasm-server.jar if missing. Runs against a throwaway H2 folder; no database is touched.
set -euo pipefail
cd "$(dirname "$0")/../server"
[ -f target/bingoasm-server.jar ] || ./mvnw -q package -DskipTests >&2
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# The app stops right after Hibernate writes the script (the empty DB has no tables, so startup fails on purpose).
timeout 90 java -jar target/bingoasm-server.jar \
  --app.data-dir="$tmp/data" --server.port=0 \
  --spring.flyway.enabled=false --spring.jpa.hibernate.ddl-auto=none \
  --spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.PostgreSQLDialect \
  --spring.jpa.properties.jakarta.persistence.schema-generation.scripts.action=create \
  --spring.jpa.properties.jakarta.persistence.schema-generation.scripts.create-target="$tmp/schema.sql" \
  --spring.jpa.properties.hibernate.hbm2ddl.delimiter=";" --spring.jpa.properties.hibernate.format_sql=true \
  >"$tmp/run.log" 2>&1 || true
if [ ! -s "$tmp/schema.sql" ]; then
  echo "Schema was not generated. Log: " >&2
  tail -20 "$tmp/run.log" >&2
  exit 1
fi
cat "$tmp/schema.sql"
