#!/bin/bash

# Determine the database client binary to use (mysql if present, mariadb otherwise)
if command -v mysql &> /dev/null; then
  DBCLIENT="mysql"
else
  DBCLIENT="mariadb"
fi

for i in {30..0}; do
  if echo "SELECT 1" | "$DBCLIENT" -h"db" -u"root" -p"$MYSQL_ROOT_PASSWORD" &> /dev/null; then
    break
  fi
  echo "MySQL init process in progress..."
  sleep 1
done

if [ -f /docker-entrypoint-initdb.d/2_update.sql ]; then
  "$DBCLIENT" -h"db" -u"root" -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" < /docker-entrypoint-initdb.d/2_update.sql
  echo "Updated database with 2_update.sql"
fi

mariadb-upgrade -u"root" -p"$MYSQL_ROOT_PASSWORD"
