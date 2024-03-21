FROM      nginx:1.25.2-alpine

# Copy configuration files
COPY      ./nginx.conf /etc/nginx/nginx.conf
COPY      ./dojo.conf /etc/nginx/sites-enabled/dojo.conf
COPY      ./dojo-explorer.conf /etc/nginx/sites-enabled/dojo-explorer.conf
COPY      ./dojo-whirlpool.conf /etc/nginx/sites-enabled/dojo-whirlpool.conf

# Copy wait-for script
COPY      --chmod=754 ./wait-for /wait-for
