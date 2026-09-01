FROM    mariadb:12.1.2

ENV     MARIADB_AUTO_UPGRADE=true

# MariaDB must read this, but should not modify it
COPY    --chown=root:mysql --chmod=0440 \
        ./docker/my-dojo/mysql/mysql-dojo.cnf \
        /etc/mysql/conf.d/mysql-dojo.cnf

# Executable by root and the mysql group
COPY    --chown=root:mysql --chmod=0550 \
        ./docker/my-dojo/mysql/update-db.sh \
        /update-db.sh

# MariaDB initialization scripts only need to be readable
COPY    --chown=root:mysql --chmod=0440 \
        ./db-scripts/*.sql \
        /docker-entrypoint-initdb.d/
