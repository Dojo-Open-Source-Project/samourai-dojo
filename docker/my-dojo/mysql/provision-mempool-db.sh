#!/bin/bash
set -euo pipefail

: "${MYSQL_ROOT_PASSWORD:?Missing Dojo root password}"
: "${MYSQL_DATABASE:?Missing Dojo database name}"
: "${MYSQL_USER:?Missing Dojo user name}"
: "${MEMPOOL_MYSQL_DATABASE:?Missing mempool database name}"
: "${MEMPOOL_MYSQL_USER:?Missing mempool user name}"
: "${MEMPOOL_MYSQL_PASS:?Missing mempool password}"

# Names are interpolated into SQL identifiers. Passwords are quoted separately.
if [[ ! "$MEMPOOL_MYSQL_DATABASE" =~ ^[a-zA-Z0-9_-]+$ ]] ||
    [[ ! "$MEMPOOL_MYSQL_USER" =~ ^[a-zA-Z0-9_-]+$ ]] ||
    [[ "${MEMPOOL_MYSQL_DATABASE,,}" == "${MYSQL_DATABASE,,}" ]] ||
    [[ "${MEMPOOL_MYSQL_USER,,}" == "${MYSQL_USER,,}" ]] ||
    [[ "${MEMPOOL_MYSQL_USER,,}" == "root" ]] ||
    [[ "${MEMPOOL_MYSQL_DATABASE,,}" =~ ^(mysql|information_schema|performance_schema|sys)$ ]]; then
  echo "Mempool requires its own database and user with names containing only letters, digits, underscores or hyphens." >&2
  exit 1
fi

export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
ready=false
for ((attempt = 0; attempt < 120; attempt++)); do
  if mariadb --host=db --user=root --execute='SELECT 1' > /dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo "Dojo MariaDB did not become ready for mempool provisioning." >&2
  exit 1
fi

# NO_BACKSLASH_ESCAPES makes SQL string quoting independent of server defaults.
password=${MEMPOOL_MYSQL_PASS//\'/\'\'}
# GRANT treats underscores in database names as wildcards unless escaped.
grant_database=${MEMPOOL_MYSQL_DATABASE//_/\\_}
mariadb --host=db --user=root <<SQL
SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES';
CREATE DATABASE IF NOT EXISTS \`$MEMPOOL_MYSQL_DATABASE\`;
CREATE USER IF NOT EXISTS '$MEMPOOL_MYSQL_USER'@'%' IDENTIFIED BY '$password';
ALTER USER '$MEMPOOL_MYSQL_USER'@'%' IDENTIFIED BY '$password';
GRANT ALL PRIVILEGES ON \`$grant_database\`.* TO '$MEMPOOL_MYSQL_USER'@'%';
SQL
echo "Mempool database and user are ready on Dojo MariaDB."
