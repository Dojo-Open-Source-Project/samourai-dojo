FROM      nginx:1.31.3-alpine

# Copy configuration files
COPY      ./nginx.conf /etc/nginx/nginx.conf
COPY      ./dojo.conf /etc/nginx/sites-enabled/dojo.conf

# Copy wait-for script
COPY      --chmod=754 ./wait-for /wait-for
